// background.ts
// Background script with simplified session tracking

import { GitHubStoreClient } from 'gh-store-client';
import { PaperManager } from './papers/manager';
import { SessionService } from './utils/session-service';
import { PopupManager } from './utils/popup-manager';
import { SourceIntegrationManager } from './source-integration/source-manager';
import { loguru } from './utils/logger';
import { PaperMetadata } from './papers/types';
import { loadSessionConfig, getConfigurationInMs } from './config/session';

// Import from central registry instead of individual integrations
import { sourceIntegrations } from './source-integration/registry';

const logger = loguru.getLogger('background');

// Build-time DEV flag, replaced by the rollup dev-flag plugin: true for
// development builds, false for production (NODE_ENV=production). An
// undefined flag also disables the debug block below (fail closed).
declare const __DEV_BUILD__: boolean | undefined;
const DEV_BUILD = typeof __DEV_BUILD__ !== 'undefined' && __DEV_BUILD__ === true;

// Global state
let githubToken = '';
let githubRepo = '';
let paperManager: PaperManager | null = null;
let sessionService: SessionService | null = null;
let popupManager: PopupManager | null = null;
let sourceManager: SourceIntegrationManager | null = null;

// Message validation limits and allowlists
const MAX_STRING_LENGTH = 10_000;
const MAX_ID_LENGTH = 512;
const MAX_REASON_LENGTH = 200;
const MAX_TAG_COUNT = 50;
const MAX_TAG_LENGTH = 100;
const VALID_RATINGS = ['novote', 'thumbsup', 'thumbsdown'] as const;
type RatingValue = typeof VALID_RATINGS[number];

// Validated message shapes handled by this listener (the shared Message union
// in source-integration/types.ts describes the wire format; popupAction and
// showAnnotationPopup are dispatched to PopupManager instead)
type ParsedMessage =
  | { kind: 'unrecognized' }
  | { kind: 'invalid'; error: string }
  | { kind: 'contentScriptReady' }
  | { kind: 'paperMetadata'; metadata: PaperMetadata }
  | { kind: 'getCurrentPaper' }
  | { kind: 'updateRating'; rating: RatingValue }
  | { kind: 'startSession'; sourceId: string; paperId: string }
  | { kind: 'sessionHeartbeat'; sourceId: string; paperId: string; timestamp: number }
  | { kind: 'endSession'; sourceId: string; paperId: string; reason: string }
  | { kind: 'manualPaperLog'; metadata: PaperMetadata };

type MessageResponse = { success: true } | { success: false; error: string };

// Initialize sources
function initializeSources() {
  sourceManager = new SourceIntegrationManager();
  
  // Register all sources from the central registry
  for (const integration of sourceIntegrations) {
    sourceManager.registerSource(integration);
  }
  
  logger.info('Source manager initialized with integrations:', 
    sourceIntegrations.map(int => int.id).join(', '));
  
  return sourceManager;
}

// Initialize everything
async function initialize() {
  try {
    // Initialize sources first
    initializeSources();
    
    // Load GitHub credentials from local storage (never sync: the PAT must
    // not leave this device)
    const items = await chrome.storage.local.get(['githubToken', 'githubRepo']);
    githubToken = typeof items.githubToken === 'string' ? items.githubToken : '';
    githubRepo = typeof items.githubRepo === 'string' ? items.githubRepo : '';
    
    // One-time migration: credentials saved by older versions live in sync
    // storage; move them to local and scrub sync so the PAT stops syncing
    const syncItems = await chrome.storage.sync.get(['githubToken', 'githubRepo']);
    const legacyToken = typeof syncItems.githubToken === 'string' ? syncItems.githubToken : '';
    const legacyRepo = typeof syncItems.githubRepo === 'string' ? syncItems.githubRepo : '';
    if ((legacyToken || legacyRepo) && (!githubToken || !githubRepo)) {
      const migrated: Record<string, string> = {};
      if (!githubToken && legacyToken) migrated.githubToken = legacyToken;
      if (!githubRepo && legacyRepo) migrated.githubRepo = legacyRepo;
      if (Object.keys(migrated).length > 0) {
        await chrome.storage.local.set(migrated);
        githubToken = migrated.githubToken ?? githubToken;
        githubRepo = migrated.githubRepo ?? githubRepo;
      }
      await chrome.storage.sync.remove(['githubToken', 'githubRepo']);
      logger.info('Migrated GitHub credentials from sync to local storage');
    }
    
    logger.info('Credentials loaded', { hasToken: !!githubToken, hasRepo: !!githubRepo });
    
    // Initialize paper manager if we have credentials
    if (githubToken && githubRepo) {
      const githubClient = new GitHubStoreClient(githubToken, githubRepo);
      
      // Pass the source manager to the paper manager
      paperManager = new PaperManager(githubClient, sourceManager!);
      logger.info('Paper manager initialized');
      
      // Initialize session service with paper manager
      sessionService = new SessionService(paperManager);
    } else {
      // Initialize session service without paper manager
      sessionService = new SessionService(null);
    }
    
    // Apply user-configured session settings and restore any session that
    // was checkpointed before the service worker was terminated
    await applySessionConfig();
    await sessionService.restorePersistedState();
    
    logger.info('Session service initialized');
    
    // Initialize popup manager
    popupManager = new PopupManager(
      () => sourceManager,
      () => paperManager
    );
    logger.info('Popup manager initialized');
    
    // Set up message listeners
    setupMessageListeners();
    
    // Initialize debug objects (development builds only)
    if (DEV_BUILD) {
      initializeDebugObjects();
    }
  } catch (error) {
    logger.error('Initialization error', error);
  }
}

// Load the saved session configuration and hand it to the session service
async function applySessionConfig(): Promise<void> {
  try {
    const rawConfig = await loadSessionConfig();
    sessionService?.updateConfig(getConfigurationInMs(rawConfig));
  } catch (error) {
    logger.error('Failed to apply session config', error);
  }
}

// Set up message listeners
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener(
    (raw: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      const parsed = parseRuntimeMessage(raw);
      
      // popupAction / showAnnotationPopup / showPopup are handled by PopupManager
      if (parsed.kind === 'unrecognized') {
        return false; // Not handled
      }
      
      if (parsed.kind === 'invalid') {
        logger.warning('Rejected malformed runtime message', parsed.error);
        sendResponse({ success: false, error: parsed.error });
        return true;
      }
      
      switch (parsed.kind) {
        case 'contentScriptReady': {
          if (!sender.tab?.id) {
            return false;
          }
          logger.debug('Content script ready:', sender.tab.url);
          sendResponse({ success: true });
          return true;
        }
        
        case 'paperMetadata': {
          handlePaperLog(parsed.metadata, `Received metadata for ${parsed.metadata.sourceId}:${parsed.metadata.paperId}`)
            .then(response => sendResponse(response))
            .catch(error => sendResponse(toErrorResponse(error)));
          return true; // Will respond asynchronously
        }
        
        case 'getCurrentPaper': {
          const session = sessionService?.getCurrentSession();
          const paperMetadata = session
            ? sessionService?.getPaperMetadata(session.sourceId, session.paperId)
            : null;
          logger.debug('Popup requested current paper', paperMetadata);
          sendResponse(paperMetadata ?? null);
          return true;
        }
        
        case 'updateRating': {
          handleUpdateRating(parsed.rating)
            .then(response => sendResponse(response))
            .catch(error => sendResponse(toErrorResponse(error)));
          return true; // Will respond asynchronously
        }
        
        case 'startSession': {
          sendResponse(handleStartSession(parsed.sourceId, parsed.paperId));
          return true;
        }
        
        case 'sessionHeartbeat': {
          if (!sessionService) {
            sendResponse({ success: false, error: 'Services not initialized' });
            return true;
          }
          
          // Only heartbeats matching the active session count; others come
          // from tabs whose session was superseded
          const active = sessionService.getCurrentSession();
          const ownsSession = active !== null &&
            active.sourceId === parsed.sourceId &&
            active.paperId === parsed.paperId;
          
          sendResponse(ownsSession && sessionService.recordHeartbeat()
            ? { success: true }
            : { success: false, error: 'No active session' });
          return true;
        }
        
        case 'endSession': {
          sendResponse(handleEndSession(parsed.sourceId, parsed.paperId, parsed.reason));
          return true;
        }
        
        case 'manualPaperLog': {
          handlePaperLog(parsed.metadata, 'manual paper log')
            .then(response => sendResponse(response))
            .catch(error => sendResponse(toErrorResponse(error)));
          return true; // Will respond asynchronously
        }
      }
    });
}

function toErrorResponse(error: unknown): MessageResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error'
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Plain string within the message size cap
function isBoundedString(value: unknown, maxLength = MAX_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

// Non-empty string within the message size cap
function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9._~-]+$/.test(value);
}

function isValidRating(value: unknown): value is RatingValue {
  return typeof value === 'string' && (VALID_RATINGS as readonly string[]).includes(value);
}

// Identifiers feed storage object IDs (sourceId.paperId) and metadata keys
// (sourceId:paperId), so the charset is kept separator-free. No registry
// check here: the 'url' fallback source is intentionally not registered in
// the background but still produces valid sessions from content scripts.
function resolveSourceAndPaper(sourceId: unknown, paperId: unknown): { sourceId: string; paperId: string } | null {
  if (!isValidId(sourceId) || !isValidId(paperId)) {
    return null;
  }
  return { sourceId, paperId };
}

function parseRuntimeMessage(raw: unknown): ParsedMessage {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { kind: 'unrecognized' };
  }
  
  switch (raw.type) {
    case 'contentScriptReady':
      return isBoundedString(raw.url)
        ? { kind: 'contentScriptReady' }
        : { kind: 'invalid', error: 'Invalid contentScriptReady message' };
      
    case 'paperMetadata': {
      const metadata = sanitizePaperMetadata(raw.metadata);
      return metadata
        ? { kind: 'paperMetadata', metadata }
        : { kind: 'invalid', error: 'Invalid paper metadata' };
    }
    
    case 'getCurrentPaper':
      return { kind: 'getCurrentPaper' };
      
    case 'updateRating': {
      if (!isValidRating(raw.rating)) {
        return { kind: 'invalid', error: 'Invalid rating value' };
      }
      return { kind: 'updateRating', rating: raw.rating };
    }
      
    case 'startSession': {
      const ids = resolveSourceAndPaper(raw.sourceId, raw.paperId);
      return ids ? { kind: 'startSession', ...ids } : { kind: 'invalid', error: 'Invalid sourceId or paperId' };
    }
      
    case 'sessionHeartbeat': {
      const ids = resolveSourceAndPaper(raw.sourceId, raw.paperId);
      if (!ids || typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp)) {
        return { kind: 'invalid', error: 'Invalid sessionHeartbeat message' };
      }
      return { kind: 'sessionHeartbeat', ...ids, timestamp: raw.timestamp };
    }
      
    case 'endSession': {
      const ids = resolveSourceAndPaper(raw.sourceId, raw.paperId);
      if (!ids) {
        return { kind: 'invalid', error: 'Invalid endSession message' };
      }
      const reason = isBoundedString(raw.reason, MAX_REASON_LENGTH) ? raw.reason : 'user_action';
      return { kind: 'endSession', ...ids, reason };
    }
      
    case 'manualPaperLog': {
      const metadata = sanitizePaperMetadata(raw.metadata);
      return metadata
        ? { kind: 'manualPaperLog', metadata }
        : { kind: 'invalid', error: 'Invalid paper metadata' };
    }
      
    default:
      return { kind: 'unrecognized' };
  }
}

// Required text field, kept within the message size cap
function textOr(value: unknown, fallback: string, maxLength = MAX_STRING_LENGTH): string {
  return isBoundedString(value, maxLength) || (typeof value === 'string' && value.length === 0)
    ? value
    : fallback;
}

// Optional text field: present only when a bounded non-empty string
function optionalText(value: unknown, maxLength = MAX_STRING_LENGTH): string | undefined {
  return isBoundedString(value, maxLength) ? value : undefined;
}

// Rebuild untrusted metadata into a well-formed PaperMetadata so unknown
// fields are dropped instead of persisted to GitHub
function sanitizePaperMetadata(value: unknown): PaperMetadata | null {
  if (!isRecord(value)) {
    return null;
  }
  
  if (!isValidId(value.sourceId) || !isValidId(value.paperId) || !isBoundedString(value.url)) {
    return null;
  }
  
  const tags = Array.isArray(value.tags)
    ? value.tags
      .filter((tag): tag is string => isBoundedString(tag, MAX_TAG_LENGTH))
      .slice(0, MAX_TAG_COUNT)
    : [];
  
  const metadata: PaperMetadata = {
    sourceId: value.sourceId,
    paperId: value.paperId,
    url: value.url,
    title: textOr(value.title, ''),
    authors: textOr(value.authors, ''),
    abstract: textOr(value.abstract, ''),
    timestamp: textOr(value.timestamp, new Date().toISOString()),
    publishedDate: textOr(value.publishedDate, ''),
    tags,
    rating: isValidRating(value.rating) ? value.rating : 'novote'
  };
  
  const doi = optionalText(value.doi, MAX_ID_LENGTH);
  if (doi) {
    metadata.doi = doi;
  }
  const journalName = optionalText(value.journalName);
  if (journalName) {
    metadata.journalName = journalName;
  }
  const sourceType = optionalText(value.sourceType, MAX_ID_LENGTH);
  if (sourceType) {
    metadata.sourceType = sourceType;
  }
  
  return metadata;
}

// Handle paper metadata received from a content script
async function handlePaperLog(metadata: PaperMetadata, context: string): Promise<MessageResponse> {
  logger.info(`${context}: ${metadata.sourceId}:${metadata.paperId}`);
  
  if (sessionService) {
    sessionService.storePaperMetadata(metadata);
  }
  
  if (paperManager) {
    await paperManager.getOrCreatePaper(metadata);
    logger.debug('Paper metadata stored in GitHub');
  }
  
  return { success: true };
}

// Handle rating update
async function handleUpdateRating(rating: RatingValue): Promise<MessageResponse> {
  if (!paperManager || !sessionService) {
    return { success: false, error: 'Services not initialized' };
  }
  
  const session = sessionService.getCurrentSession();
  if (!session) {
    return { success: false, error: 'No current session' };
  }
  
  const metadata = sessionService.getPaperMetadata();
  if (!metadata) {
    return { success: false, error: 'No paper metadata available' };
  }
  
  await paperManager.updateRating(session.sourceId, session.paperId, rating, metadata);
  
  // Update stored metadata with new rating
  metadata.rating = rating;
  
  return { success: true };
}

// Handle session start request
function handleStartSession(sourceId: string, paperId: string): MessageResponse {
  if (!sessionService) {
    logger.error('Session service not initialized');
    return { success: false, error: 'Services not initialized' };
  }
  
  // Get metadata if available, then start the session
  const existingMetadata = sessionService.getPaperMetadata(sourceId, paperId);
  sessionService.startSession(sourceId, paperId, existingMetadata);
  logger.info(`Started session for ${sourceId}:${paperId}`);
  
  return { success: true };
}

// Handle session end request; only the owner of the active session may end it
function handleEndSession(sourceId: string, paperId: string, reason: string): MessageResponse {
  if (!sessionService) {
    return { success: false, error: 'Services not initialized' };
  }
  
  const session = sessionService.getCurrentSession();
  if (session && session.sourceId === sourceId && session.paperId === paperId) {
    logger.info(`Ending session: ${reason}`);
    sessionService.endSession();
  }
  
  return { success: true };
}

// Listen for credential changes; tokens live in storage.local and must never
// sync across devices
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || (!changes.githubToken && !changes.githubRepo)) {
    return;
  }
  
  logger.debug('Credential changes detected', Object.keys(changes));
  
  if (changes.githubToken) {
    githubToken = typeof changes.githubToken.newValue === 'string' ? changes.githubToken.newValue : '';
  }
  if (changes.githubRepo) {
    githubRepo = typeof changes.githubRepo.newValue === 'string' ? changes.githubRepo.newValue : '';
  }
  
  if (!sourceManager) {
    return;
  }
  
  if (githubToken && githubRepo) {
    const githubClient = new GitHubStoreClient(githubToken, githubRepo);
    paperManager = new PaperManager(githubClient, sourceManager);
    logger.info('Paper manager reinitialized');
  } else {
    // Credentials removed: release the stale client so no further requests
    // are sent with revoked credentials; queued writes stay parked until
    // valid credentials return
    paperManager = null;
    logger.info('GitHub credentials removed; released stale client');
  }
  
  // Keep the session service (and its queued writes) on the current manager
  sessionService?.setPaperManager(paperManager);
});

// Expose debug objects on the service worker scope; only wired in
// development builds (see DEV_BUILD)
function initializeDebugObjects() {
  (self as unknown as { __DEBUG__: unknown }).__DEBUG__ = {
    get paperManager() { return paperManager; },
    get sessionService() { return sessionService; },
    get popupManager() { return popupManager; },
    get sourceManager() { return sourceManager; },
    getGithubClient: () => paperManager ? paperManager.getClient() : null,
    getCurrentPaper: () => {
      const session = sessionService?.getCurrentSession();
      return session ? sessionService?.getPaperMetadata(session.sourceId, session.paperId) ?? null : null;
    },
    getSessionStats: () => sessionService?.getSessionStats(),
    getSources: () => sourceManager?.getAllSources(),
    forceEndSession: () => sessionService?.endSession() ?? null
  };
  
  logger.info('Debug objects registered');
}

// Initialize extension
initialize();
