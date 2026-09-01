// session-service.ts
// Simplified session tracking service for background script

import { loguru } from './logger';
import { PaperManager } from '../papers/manager';
import { ReadingSessionData, PaperMetadata } from '../papers/types';
import { getConfigurationInMs, DEFAULT_CONFIG } from '../config/session';
import { SessionConfig } from '../config/types';

const logger = loguru.getLogger('session-service');

// MV3 service workers are terminated after ~30s idle; session state is
// checkpointed into chrome.storage.session on every heartbeat and restored
// on worker startup so sessions survive worker restarts
const CHECKPOINT_KEY = 'activeSessionCheckpoint';
const PENDING_WRITES_KEY = 'pendingSessionWrites';

// Bounds for the end-of-session write retry queue
const MAX_WRITE_ATTEMPTS = 3;
const MAX_QUEUE_SIZE = 50;

// Serialized active-session state kept in chrome.storage.session
interface SessionCheckpoint {
  sourceId: string;
  paperId: string;
  startTime: string;
  heartbeatCount: number;
  lastHeartbeatTime: string;
  metadata?: PaperMetadata;
}

// End-of-session write awaiting delivery to GitHub
interface PendingSessionWrite {
  sourceId: string;
  paperId: string;
  session: ReadingSessionData;
  metadata?: PaperMetadata;
  attempts: number;
}

export class SessionService {
  private activeSession: {
    sourceId: string;
    paperId: string;
    startTime: Date;
    heartbeatCount: number;
    lastHeartbeatTime: Date;
  } | null = null;
  
  private timeoutId: number | null = null;
  private paperMetadata: Map<string, PaperMetadata> = new Map();
  
  // Bounded retry queue for end-of-session GitHub writes
  private pendingWrites: PendingSessionWrite[] = [];
  private flushing = false;
  
  // Configuration in millisecond units; see config/session.ts
  private config: SessionConfig;
  
  /**
   * Create a new session service
   */
  constructor(
    private paperManager: PaperManager | null,
    config?: SessionConfig
  ) {
    this.config = config ?? getConfigurationInMs(DEFAULT_CONFIG);
    logger.debug('Session service initialized');
  }
  
  /**
   * Apply updated session configuration (idle threshold, min duration, etc.)
   */
  updateConfig(config: SessionConfig): void {
    this.config = config;
    if (this.activeSession) {
      this.scheduleTimeoutCheck();
    }
    logger.debug('Session config updated', config);
  }
  
  /**
   * Swap the paper manager used for session writes (credential changes).
   * Keeping the same service instance preserves the active session, any
   * checkpoint, and queued writes; a null manager just parks the queue.
   */
  setPaperManager(paperManager: PaperManager | null): void {
    this.paperManager = paperManager;
    logger.debug('Paper manager updated', { hasManager: paperManager !== null });
  }
  
  // chrome.storage.session is only available to MV3 workers; without it we
  // degrade to the previous in-memory behavior
  private getSessionStore(): chrome.storage.StorageArea | null {
    try {
      return chrome.storage?.session ?? null;
    } catch {
      return null;
    }
  }
  
  /**
   * Start a new session for a paper
   */
  startSession(sourceId: string, paperId: string, metadata?: PaperMetadata): void {
    // End any existing session
    this.endSession();
    
    // Create new session
    this.activeSession = {
      sourceId,
      paperId,
      startTime: new Date(),
      heartbeatCount: 0,
      lastHeartbeatTime: new Date()
    };
    
    // Store metadata if provided
    if (metadata) {
      const key = `${sourceId}:${paperId}`;
      this.paperMetadata.set(key, metadata);
      logger.debug(`Stored metadata for ${key}`);
    }
    
    // Start timeout check and checkpoint the new session so it can be
    // restored if the service worker is terminated
    this.scheduleTimeoutCheck();
    void this.persistCheckpoint();
    
    logger.info(`Started session for ${sourceId}:${paperId}`);
  }
  
  /**
   * Record a heartbeat for the current session
   */
  recordHeartbeat(): boolean {
    if (!this.activeSession) {
      return false;
    }
    
    this.activeSession.heartbeatCount++;
    this.activeSession.lastHeartbeatTime = new Date();
    
    // Reschedule timeout
    this.scheduleTimeoutCheck();
    
    // Checkpoint after every heartbeat so the worker can be killed and
    // restored at any point without losing session progress
    void this.persistCheckpoint();
    
    // Retry any queued end-of-session writes while the worker is alive
    void this.flushPendingWrites();
    
    if (this.activeSession.heartbeatCount % 12 === 0) { // Log every minute (12 x 5sec heartbeats)
      logger.debug(`Session received ${this.activeSession.heartbeatCount} heartbeats`);
    }
    
    return true;
  }
  
  /**
   * Restore checkpointed session state and queued writes after a worker restart.
   * Must be awaited (or at least invoked) during worker startup.
   */
  async restorePersistedState(): Promise<void> {
    const store = this.getSessionStore();
    if (!store) return;
    
    try {
      const items = await store.get([CHECKPOINT_KEY, PENDING_WRITES_KEY]);
      
      // Restore the write queue first so queued sessions are not lost
      const pending = items[PENDING_WRITES_KEY];
      if (Array.isArray(pending)) {
        for (const entry of pending) {
          if (this.isValidPendingWrite(entry) && this.pendingWrites.length < MAX_QUEUE_SIZE) {
            this.pendingWrites.push(entry);
          }
        }
        if (this.pendingWrites.length > 0) {
          logger.info(`Restored ${this.pendingWrites.length} pending session write(s)`);
        }
      }
      
      const checkpoint = items[CHECKPOINT_KEY] as SessionCheckpoint | undefined;
      if (this.isValidCheckpoint(checkpoint)) {
        const lastHeartbeatTime = new Date(checkpoint.lastHeartbeatTime);
        
        this.activeSession = {
          sourceId: checkpoint.sourceId,
          paperId: checkpoint.paperId,
          startTime: new Date(checkpoint.startTime),
          heartbeatCount: checkpoint.heartbeatCount,
          lastHeartbeatTime
        };
        
        if (checkpoint.metadata) {
          this.paperMetadata.set(
            `${checkpoint.sourceId}:${checkpoint.paperId}`,
            checkpoint.metadata
          );
        }
        
        logger.info(`Restored session for ${checkpoint.sourceId}:${checkpoint.paperId}`, {
          heartbeatCount: checkpoint.heartbeatCount
        });
        
        // Heartbeats stopped while the worker was down: finalize the session
        // if the silence exceeds the idle threshold, otherwise keep it alive
        if (Date.now() - lastHeartbeatTime.getTime() > this.config.idleThreshold) {
          this.checkTimeout();
        } else {
          this.scheduleTimeoutCheck();
        }
      }
      
      void this.flushPendingWrites();
    } catch (error) {
      logger.error('Failed to restore session state', error);
    }
  }
  
  /**
   * Schedule a check for heartbeat timeout
   */
  private scheduleTimeoutCheck(): void {
    // Clear existing timeout
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
    }
    
    // Set new timeout based on the configured idle threshold
    this.timeoutId = self.setTimeout(() => {
      this.checkTimeout();
    }, this.config.idleThreshold);
  }
  
  /**
   * Check if the session has timed out due to missing heartbeats
   */
  private checkTimeout(): void {
    if (!this.activeSession) return;
    
    const now = Date.now();
    const lastTime = this.activeSession.lastHeartbeatTime.getTime();
    
    if ((now - lastTime) > this.config.idleThreshold) {
      if (this.config.requireContinuousActivity) {
        logger.info('Session timeout detected');
        this.endSession();
      } else {
        // Continuous activity not required: keep the session alive across
        // idle gaps and keep checking
        this.scheduleTimeoutCheck();
      }
    } else {
      this.scheduleTimeoutCheck();
    }
  }
  
  /**
   * Whether a finished session is long enough to be logged, honoring the
   * configured minimum duration and partial-session flag
   */
  private shouldLogSession(sessionData: ReadingSessionData): boolean {
    return sessionData.duration_seconds * 1000 >= this.config.minSessionDuration ||
      this.config.logPartialSessions;
  }
  
  /**
   * End the current session and get the data
   */
  endSession(): ReadingSessionData | null {
    if (!this.activeSession) return null;
    
    // Clear timeout
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    
    const { sourceId, paperId, startTime, heartbeatCount } = this.activeSession;
    const endTime = new Date();
    
    // Calculate duration (5 seconds per heartbeat)
    const duration = heartbeatCount * 5;
    
    // Calculate total elapsed time
    const totalElapsed = endTime.getTime() - startTime.getTime();
    const totalElapsedSeconds = Math.round(totalElapsed / 1000);
    
    // Set idle seconds to the difference (for backward compatibility)
    const idleSeconds = Math.max(0, totalElapsedSeconds - duration);
    
    // Create session data
    const sessionData: ReadingSessionData = {
      session_id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      source_id: sourceId,
      paper_id: paperId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      heartbeat_count: heartbeatCount,
      duration_seconds: duration,
      // Legacy fields
      idle_seconds: idleSeconds,
      total_elapsed_seconds: totalElapsedSeconds
    };
    
    // Queue the session for storage if it was meaningful and we have a
    // paper manager; the bounded retry queue protects the write from the
    // worker dying mid-request
    if (this.paperManager && heartbeatCount > 0 && this.shouldLogSession(sessionData)) {
      const metadata = this.getPaperMetadata(sourceId, paperId);
      this.queueSessionWrite(sourceId, paperId, sessionData, metadata);
    }
    
    logger.info(`Ended session for ${sourceId}:${paperId}`, {
      duration,
      heartbeats: heartbeatCount
    });
    
    // Clear active session
    this.activeSession = null;
    void this.clearCheckpoint();
    
    return sessionData;
  }
  
  /**
   * Add an end-of-session write to the bounded retry queue
   */
  private queueSessionWrite(
    sourceId: string,
    paperId: string,
    sessionData: ReadingSessionData,
    metadata?: PaperMetadata
  ): void {
    if (this.pendingWrites.length >= MAX_QUEUE_SIZE) {
      logger.warning('Pending session write queue full, dropping oldest entry');
      this.pendingWrites.shift();
    }
    
    this.pendingWrites.push({ sourceId, paperId, session: sessionData, metadata, attempts: 0 });
    void this.persistPendingWrites();
    void this.flushPendingWrites();
  }
  
  /**
   * Attempt to deliver queued session writes; failures stay queued up to
   * MAX_WRITE_ATTEMPTS and are retried on the next heartbeat or worker start
   */
  private async flushPendingWrites(): Promise<void> {
    if (this.flushing || !this.paperManager) return;
    this.flushing = true;
    
    try {
      while (this.pendingWrites.length > 0) {
        const entry = this.pendingWrites[0];
        
        try {
          await this.paperManager.logReadingSession(
            entry.sourceId,
            entry.paperId,
            entry.session,
            entry.metadata
          );
          this.pendingWrites.shift();
          await this.persistPendingWrites();
        } catch (error) {
          entry.attempts++;
          logger.error(`Failed to store session for ${entry.sourceId}:${entry.paperId} (attempt ${entry.attempts}/${MAX_WRITE_ATTEMPTS})`, error);
          
          if (entry.attempts >= MAX_WRITE_ATTEMPTS) {
            this.pendingWrites.shift();
            await this.persistPendingWrites();
          }
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  
  /**
   * Mirror the write queue into chrome.storage.session so it survives
   * service worker restarts
   */
  private async persistPendingWrites(): Promise<void> {
    const store = this.getSessionStore();
    if (!store) return;
    
    try {
      await store.set({ [PENDING_WRITES_KEY]: this.pendingWrites });
    } catch (error) {
      logger.error('Failed to persist pending session writes', error);
    }
  }
  
  /**
   * Checkpoint the active session into chrome.storage.session so it can be
   * restored after the MV3 worker is killed
   */
  private async persistCheckpoint(): Promise<void> {
    const store = this.getSessionStore();
    if (!store || !this.activeSession) return;
    
    const checkpoint: SessionCheckpoint = {
      sourceId: this.activeSession.sourceId,
      paperId: this.activeSession.paperId,
      startTime: this.activeSession.startTime.toISOString(),
      heartbeatCount: this.activeSession.heartbeatCount,
      lastHeartbeatTime: this.activeSession.lastHeartbeatTime.toISOString(),
      metadata: this.getPaperMetadata(this.activeSession.sourceId, this.activeSession.paperId)
    };
    
    try {
      await store.set({ [CHECKPOINT_KEY]: checkpoint });
    } catch (error) {
      logger.error('Failed to persist session checkpoint', error);
    }
  }
  
  private async clearCheckpoint(): Promise<void> {
    const store = this.getSessionStore();
    if (!store) return;
    
    try {
      await store.remove(CHECKPOINT_KEY);
    } catch (error) {
      logger.error('Failed to clear session checkpoint', error);
    }
  }
  
  private isValidCheckpoint(value: unknown): value is SessionCheckpoint {
    if (typeof value !== 'object' || value === null) return false;
    const checkpoint = value as Partial<SessionCheckpoint>;
    return (
      typeof checkpoint.sourceId === 'string' && checkpoint.sourceId.length > 0 &&
      typeof checkpoint.paperId === 'string' && checkpoint.paperId.length > 0 &&
      typeof checkpoint.heartbeatCount === 'number' && Number.isFinite(checkpoint.heartbeatCount) &&
      checkpoint.heartbeatCount >= 0 &&
      typeof checkpoint.startTime === 'string' && !Number.isNaN(new Date(checkpoint.startTime).getTime()) &&
      typeof checkpoint.lastHeartbeatTime === 'string' &&
      !Number.isNaN(new Date(checkpoint.lastHeartbeatTime).getTime())
    );
  }
  
  private isValidPendingWrite(value: unknown): value is PendingSessionWrite {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as PendingSessionWrite;
    return (
      typeof entry.sourceId === 'string' &&
      typeof entry.paperId === 'string' &&
      typeof entry.attempts === 'number' &&
      entry.attempts < MAX_WRITE_ATTEMPTS &&
      typeof entry.session === 'object' && entry.session !== null &&
      typeof entry.session.session_id === 'string'
    );
  }
  
  /**
   * Check if a session is currently active
   */
  hasActiveSession(): boolean {
    return this.activeSession !== null;
  }
  
  /**
   * Get information about the current session
   */
  getCurrentSession(): { sourceId: string, paperId: string } | null {
    if (!this.activeSession) return null;
    
    return {
      sourceId: this.activeSession.sourceId,
      paperId: this.activeSession.paperId
    };
  }
  
  /**
   * Get paper metadata for the current or specified session
   */
  getPaperMetadata(sourceId?: string, paperId?: string): PaperMetadata | undefined {
    if (!sourceId || !paperId) {
      if (!this.activeSession) return undefined;
      sourceId = this.activeSession.sourceId;
      paperId = this.activeSession.paperId;
    }
    
    return this.paperMetadata.get(`${sourceId}:${paperId}`);
  }
  
  /**
   * Store paper metadata
   */
  storePaperMetadata(metadata: PaperMetadata): void {
    const key = `${metadata.sourceId}:${metadata.paperId}`;
    this.paperMetadata.set(key, metadata);
  }
  
  /**
   * Get time since last heartbeat in milliseconds
   */
  getTimeSinceLastHeartbeat(): number | null {
    if (!this.activeSession) {
      return null;
    }
    
    return Date.now() - this.activeSession.lastHeartbeatTime.getTime();
  }
  
  /**
   * Get session statistics for debugging
   */
  getSessionStats(): any {
    if (!this.activeSession) {
      return { active: false };
    }
    
    return {
      active: true,
      sourceId: this.activeSession.sourceId,
      paperId: this.activeSession.paperId,
      startTime: this.activeSession.startTime.toISOString(),
      heartbeatCount: this.activeSession.heartbeatCount,
      lastHeartbeatTime: this.activeSession.lastHeartbeatTime.toISOString(),
      elapsedTime: Math.round((Date.now() - this.activeSession.startTime.getTime()) / 1000)
    };
  }
}
