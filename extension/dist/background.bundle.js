var f=(i=>(i.GH_STORE="gh-store",i.STORED_OBJECT="stored-object",i.DEPRECATED="deprecated-object",i.UID_PREFIX="UID:",i.ALIAS_TO_PREFIX="ALIAS-TO:",i))(f||{});var m=class{constructor(e={}){this.cache=new Map,this.maxSize=e.maxSize??1e3,this.ttl=e.ttl??1e3*60*60,this.accessOrder=[];}get(e){let t=this.cache.get(e);if(t){if(Date.now()-t.lastAccessed>this.ttl){this.cache.delete(e),this.removeFromAccessOrder(e);return}return t.lastAccessed=Date.now(),this.updateAccessOrder(e),t.issueNumber}}set(e,t,r){if(this.cache.size>=this.maxSize&&!this.cache.has(e)){let s=this.accessOrder[this.accessOrder.length-1];s&&(this.cache.delete(s),this.removeFromAccessOrder(s));}this.cache.set(e,{issueNumber:t,lastAccessed:Date.now(),createdAt:r.createdAt,updatedAt:r.updatedAt}),this.updateAccessOrder(e);}remove(e){this.cache.delete(e),this.removeFromAccessOrder(e);}clear(){this.cache.clear(),this.accessOrder=[];}getStats(){return {size:this.cache.size,maxSize:this.maxSize,ttl:this.ttl}}shouldRefresh(e,t){let r=this.cache.get(e);return r?t>r.updatedAt:!0}updateAccessOrder(e){this.removeFromAccessOrder(e),this.accessOrder.unshift(e);}removeFromAccessOrder(e){let t=this.accessOrder.indexOf(e);t>-1&&this.accessOrder.splice(t,1);}};var y="0.11.1";var d=class{constructor(e,t,r={}){if(this.token=e,this.repo=t,!this.repo)throw new Error("Repository is required");this.config={baseLabel:r.baseLabel??"stored-object",uidPrefix:r.uidPrefix??"UID:",reactions:{processed:r.reactions?.processed??"+1",initialState:r.reactions?.initialState??"rocket"}},this.cache=new m(r.cache);}isPublic(){return this.token===null}async fetchFromGitHub(e,t={}){let r=new URL(`https://api.github.com/repos/${this.repo}${e}`);t.params&&(Object.entries(t.params).forEach(([a,n])=>{r.searchParams.append(a,n);}),delete t.params);let s={Accept:"application/vnd.github.v3+json"};if(t.headers){let a=t.headers;Object.keys(a).forEach(n=>{s[n]=a[n];});}this.token&&(s.Authorization=`token ${this.token}`);let i=await fetch(r.toString(),{...t,headers:s});if(!i.ok)throw new Error(`GitHub API error: ${i.status}`);return i.json()}createCommentPayload(e,t,r){let s={_data:e,_meta:{client_version:y,timestamp:new Date().toISOString(),update_mode:"append",issue_number:t}};return r&&(s.type=r),s}async getObject(e){let t=this.cache.get(e),r;if(t)try{r=await this.fetchFromGitHub(`/issues/${t}`),this._verifyIssueLabels(r,e)||(this.cache.remove(e),r=void 0);}catch{this.cache.remove(e);}if(!r){let c=await this.fetchFromGitHub("/issues",{method:"GET",params:{labels:["gh-store",this.config.baseLabel,`${this.config.uidPrefix}${e}`].join(","),state:"closed"}});if(!c||c.length===0)throw new Error(`No object found with ID: ${e}`);r=c[0];}if(!r?.body)throw new Error(`Invalid issue data received for ID: ${e}`);let s=JSON.parse(r.body),i=new Date(r.created_at),a=new Date(r.updated_at);return this.cache.set(e,r.number,{createdAt:i,updatedAt:a}),{meta:{objectId:e,label:`${this.config.uidPrefix}${e}`,issueNumber:r.number,createdAt:i,updatedAt:a,version:await this._getVersion(r.number)},data:s}}async createObject(e,t,r=[]){if(!this.token)throw new Error("Authentication required for creating objects");let s=`${this.config.uidPrefix}${e}`,i=["gh-store",this.config.baseLabel,s,...r],a=await this.fetchFromGitHub("/issues",{method:"POST",body:JSON.stringify({title:`Stored Object: ${e}`,body:JSON.stringify(t,null,2),labels:i})});this.cache.set(e,a.number,{createdAt:new Date(a.created_at),updatedAt:new Date(a.updated_at)});let n=this.createCommentPayload(t,a.number,"initial_state"),c=await this.fetchFromGitHub(`/issues/${a.number}/comments`,{method:"POST",body:JSON.stringify({body:JSON.stringify(n,null,2)})});return await this.fetchFromGitHub(`/issues/comments/${c.id}/reactions`,{method:"POST",body:JSON.stringify({content:this.config.reactions.processed})}),await this.fetchFromGitHub(`/issues/comments/${c.id}/reactions`,{method:"POST",body:JSON.stringify({content:this.config.reactions.initialState})}),await this.fetchFromGitHub(`/issues/${a.number}`,{method:"PATCH",body:JSON.stringify({state:"closed"})}),{meta:{objectId:e,label:s,issueNumber:a.number,createdAt:new Date(a.created_at),updatedAt:new Date(a.updated_at),version:1},data:t}}_verifyIssueLabels(e,t){let r=new Set([this.config.baseLabel,`${this.config.uidPrefix}${t}`]);return e.labels.some(s=>r.has(s.name))}async updateObject(e,t){if(!this.token)throw new Error("Authentication required for updating objects");let r=await this.fetchFromGitHub("/issues",{method:"GET",params:{labels:[this.config.baseLabel,`${this.config.uidPrefix}${e}`].join(","),state:"all"}});if(!r||r.length===0)throw new Error(`No object found with ID: ${e}`);let s=r[0],i=this.createCommentPayload(t,s.number);return await this.fetchFromGitHub(`/issues/${s.number}/comments`,{method:"POST",body:JSON.stringify({body:JSON.stringify(i,null,2)})}),await this.fetchFromGitHub(`/issues/${s.number}`,{method:"PATCH",body:JSON.stringify({state:"open"})}),this.getObject(e)}async listAll(){let e=await this.fetchFromGitHub("/issues",{method:"GET",params:{labels:this.config.baseLabel,state:"closed"}}),t={};for(let r of e)if(!r.labels.some(s=>s.name==="archived"))try{let s=this._getObjectIdFromLabels(r),i=JSON.parse(r.body),a={objectId:s,label:s,issueNumber:r.number,createdAt:new Date(r.created_at),updatedAt:new Date(r.updated_at),version:await this._getVersion(r.number)};t[s]={meta:a,data:i};}catch{continue}return t}async listUpdatedSince(e){let t=await this.fetchFromGitHub("/issues",{method:"GET",params:{labels:this.config.baseLabel,state:"closed",since:e.toISOString()}}),r={};for(let s of t)if(!s.labels.some(i=>i.name==="archived"))try{let i=this._getObjectIdFromLabels(s),a=JSON.parse(s.body),n=new Date(s.updated_at);if(n>e){let c={objectId:i,label:i,issueNumber:s.number,createdAt:new Date(s.created_at),updatedAt:n,version:await this._getVersion(s.number)};r[i]={meta:c,data:a};}}catch{continue}return r}async getObjectHistory(e){let t=await this.fetchFromGitHub("/issues",{method:"GET",params:{labels:[this.config.baseLabel,`${this.config.uidPrefix}${e}`].join(","),state:"all"}});if(!t||t.length===0)throw new Error(`No object found with ID: ${e}`);let r=t[0],s=await this.fetchFromGitHub(`/issues/${r.number}/comments`),i=[];for(let a of s)try{let n=JSON.parse(a.body),c="update",u,p={client_version:"legacy",timestamp:a.created_at,update_mode:"append"};typeof n=="object"?"_data"in n?(c=n.type||"update",u=n._data,p=n._meta||p):"type"in n&&n.type==="initial_state"?(c="initial_state",u=n.data):u=n:u=n,i.push({timestamp:a.created_at,type:c,data:u,commentId:a.id});}catch{continue}return i}async _getVersion(e){return (await this.fetchFromGitHub(`/issues/${e}/comments`)).length+1}_getObjectIdFromLabels(e){for(let t of e.labels)if(t.name!==this.config.baseLabel&&t.name.startsWith(this.config.uidPrefix))return t.name.slice(this.config.uidPrefix.length);throw new Error(`No UID label found with prefix ${this.config.uidPrefix}`)}};var E={level:"info",silent:!1},A={error:3,warn:2,info:1,debug:0},b=class{constructor(e,t={}){this.entries=[];this.moduleName=e,this.config={...E,...t};}debug(e,t){this.log("debug",e,t);}info(e,t){this.log("info",e,t);}warn(e,t){this.log("warn",e,t);}error(e,t){this.log("error",e,t);}log(e,t,r){if(A[e]<A[this.config.level])return;let s={timestamp:new Date().toISOString(),level:e,module:this.moduleName,message:t,metadata:r};this.entries.push(s);}getEntries(){return [...this.entries]}clearEntries(){this.entries=[];}configure(e){this.config={...this.config,...e};}getConfig(){return {...this.config}}};new b("CanonicalStore");

// extension/papers/types.ts
// Updated for heartbeat-based session tracking
/**
 * Type guard for interaction log
 */
function isInteractionLog(data) {
    const log = data;
    return (typeof log === 'object' &&
        log !== null &&
        typeof log.sourceId === 'string' &&
        typeof log.paperId === 'string' &&
        Array.isArray(log.interactions));
}

// utils/logger.ts
// Logging utility wrapping loguru
/**
 * Logger class for consistent logging throughout the extension
 */
class Logger {
    constructor(module) {
        this.module = module;
    }
    /**
     * Log debug message
     */
    debug(message, data) {
        console.debug(`[${this.module}] ${message}`, data !== undefined ? data : '');
    }
    /**
     * Log info message
     */
    info(message, data) {
        console.info(`[${this.module}] ${message}`, data !== undefined ? data : '');
    }
    /**
     * Log warning message
     */
    warning(message, data) {
        console.warn(`[${this.module}] ${message}`, data !== undefined ? data : '');
    }
    /**
     * Alias for warning method (to match loguru API)
     */
    warn(message, data) {
        this.warning(message, data);
    }
    /**
     * Log error message
     */
    error(message, data) {
        console.error(`[${this.module}] ${message}`, data !== undefined ? data : '');
    }
}
/**
 * Loguru mock for browser extension use
 */
class LoguruMock {
    /**
     * Get logger for a module
     */
    getLogger(module) {
        return new Logger(module);
    }
}
// Export singleton instance
const loguru = new LoguruMock();

const logger$9 = loguru.getLogger('paper-manager');
class PaperManager {
    constructor(client, sourceManager) {
        this.client = client;
        this.sourceManager = sourceManager;
        logger$9.debug('Paper manager initialized');
    }
    /**
     * Get paper by source and ID
     */
    async getPaper(sourceId, paperId) {
        const objectId = this.sourceManager.formatObjectId('paper', sourceId, paperId);
        try {
            const obj = await this.client.getObject(objectId);
            return obj.data;
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('No object found')) {
                return null;
            }
            throw error;
        }
    }
    /**
     * Get or create paper metadata
     */
    async getOrCreatePaper(paperData) {
        const { sourceId, paperId } = paperData;
        const objectId = this.sourceManager.formatObjectId('paper', sourceId, paperId);
        const paperIdentifier = this.sourceManager.formatPaperId(sourceId, paperId);
        try {
            const obj = await this.client.getObject(objectId);
            const data = obj.data;
            logger$9.debug(`Retrieved existing paper: ${paperIdentifier}`);
            return data;
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('No object found')) {
                // Create new paper
                const defaultPaperData = {
                    ...paperData,
                    timestamp: new Date().toISOString(),
                    rating: paperData.rating || 'novote'
                };
                const newobj = await this.client.createObject(objectId, defaultPaperData);
                logger$9.debug(`Created new paper: ${paperIdentifier}`);
                // reopen to trigger metadata hydration
                await this.client.fetchFromGitHub(`/issues/${newobj.meta.issueNumber}`, {
                    method: "PATCH",
                    body: JSON.stringify({ state: "open" })
                });
                return defaultPaperData;
            }
            throw error;
        }
    }
    /**
     * Get or create interaction log for a paper
     */
    async getOrCreateInteractionLog(sourceId, paperId) {
        const objectId = this.sourceManager.formatObjectId('interactions', sourceId, paperId);
        const paperIdentifier = this.sourceManager.formatPaperId(sourceId, paperId);
        try {
            const obj = await this.client.getObject(objectId);
            const data = obj.data;
            if (isInteractionLog(data)) {
                return data;
            }
            throw new Error('Invalid interaction log format');
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('No object found')) {
                const newLog = {
                    sourceId,
                    paperId,
                    interactions: []
                };
                await this.client.createObject(objectId, newLog);
                logger$9.debug(`Created new interaction log: ${paperIdentifier}`);
                return newLog;
            }
            throw error;
        }
    }
    /**
     * Get GitHub client instance
     */
    getClient() {
        return this.client;
    }
    /**
     * Log a reading session
     */
    async logReadingSession(sourceId, paperId, session, paperData) {
        // Ensure paper exists
        if (paperData) {
            await this.getOrCreatePaper({
                sourceId,
                paperId,
                url: paperData.url || this.sourceManager.formatPaperId(sourceId, paperId),
                title: paperData.title || paperId,
                authors: paperData.authors || '',
                abstract: paperData.abstract || '',
                timestamp: new Date().toISOString(),
                rating: 'novote',
                publishedDate: paperData.publishedDate || '',
                tags: paperData.tags || []
            });
        }
        // Log the session as an interaction
        await this.addInteraction(sourceId, paperId, {
            type: 'reading_session',
            timestamp: new Date().toISOString(),
            data: session
        });
        const paperIdentifier = this.sourceManager.formatPaperId(sourceId, paperId);
        logger$9.info(`Logged reading session for ${paperIdentifier}`, { duration: session.duration_seconds });
    }
    /**
     * Log an annotation
     */
    async logAnnotation(sourceId, paperId, key, value, paperData) {
        // Ensure paper exists
        if (paperData) {
            await this.getOrCreatePaper({
                sourceId,
                paperId,
                url: paperData.url || this.sourceManager.formatPaperId(sourceId, paperId),
                title: paperData.title || paperId,
                authors: paperData.authors || '',
                abstract: paperData.abstract || '',
                timestamp: new Date().toISOString(),
                rating: 'novote',
                publishedDate: paperData.publishedDate || '',
                tags: paperData.tags || []
            });
        }
        // Log the annotation as an interaction
        await this.addInteraction(sourceId, paperId, {
            type: 'annotation',
            timestamp: new Date().toISOString(),
            data: { key, value }
        });
        const paperIdentifier = this.sourceManager.formatPaperId(sourceId, paperId);
        logger$9.info(`Logged annotation for ${paperIdentifier}`, { key });
    }
    /**
     * Update paper rating
     */
    async updateRating(sourceId, paperId, rating, paperData) {
        // Ensure paper exists and get current data
        const paper = await this.getOrCreatePaper({
            sourceId,
            paperId,
            url: paperData?.url || this.sourceManager.formatPaperId(sourceId, paperId),
            title: paperData?.title || paperId,
            authors: paperData?.authors || '',
            abstract: paperData?.abstract || '',
            timestamp: new Date().toISOString(),
            rating: 'novote',
            publishedDate: paperData?.publishedDate || '',
            tags: paperData?.tags || []
        });
        const objectId = this.sourceManager.formatObjectId('paper', sourceId, paperId);
        // Update paper metadata with new rating
        await this.client.updateObject(objectId, {
            ...paper,
            rating
        });
        // Log rating change as an interaction
        await this.addInteraction(sourceId, paperId, {
            type: 'rating',
            timestamp: new Date().toISOString(),
            data: { rating }
        });
        const paperIdentifier = this.sourceManager.formatPaperId(sourceId, paperId);
        logger$9.info(`Updated rating for ${paperIdentifier} to ${rating}`);
    }
    /**
     * Add interaction to log
     */
    async addInteraction(sourceId, paperId, interaction) {
        const log = await this.getOrCreateInteractionLog(sourceId, paperId);
        log.interactions.push(interaction);
        const objectId = this.sourceManager.formatObjectId('interactions', sourceId, paperId);
        await this.client.updateObject(objectId, log);
    }
}

// config/session.ts
const logger$8 = loguru.getLogger('session-config');
// Sane bounds for numeric settings; values outside these ranges are rejected
// on save and fall back to defaults on load
const NUMERIC_BOUNDS = {
    idleThresholdMinutes: { min: 1, max: 60 },
    minSessionDurationSeconds: { min: 1, max: 300 },
    activityUpdateIntervalSeconds: { min: 1, max: 60 }
};
// Default configuration values
const DEFAULT_CONFIG = {
    idleThresholdMinutes: 5,
    minSessionDurationSeconds: 30,
    requireContinuousActivity: true, // If true, resets timer on idle
    logPartialSessions: false, // If true, logs sessions even if under minimum duration
    activityUpdateIntervalSeconds: 1 // How often to update active time
};
/**
 * Load session configuration from storage
 */
async function loadSessionConfig() {
    try {
        const items = await chrome.storage.sync.get('sessionConfig');
        const stored = (items.sessionConfig ?? {});
        const config = {
            idleThresholdMinutes: numericOr(stored.idleThresholdMinutes, DEFAULT_CONFIG.idleThresholdMinutes, NUMERIC_BOUNDS.idleThresholdMinutes.min, NUMERIC_BOUNDS.idleThresholdMinutes.max),
            minSessionDurationSeconds: numericOr(stored.minSessionDurationSeconds, DEFAULT_CONFIG.minSessionDurationSeconds, NUMERIC_BOUNDS.minSessionDurationSeconds.min, NUMERIC_BOUNDS.minSessionDurationSeconds.max),
            requireContinuousActivity: typeof stored.requireContinuousActivity === 'boolean'
                ? stored.requireContinuousActivity : DEFAULT_CONFIG.requireContinuousActivity,
            logPartialSessions: typeof stored.logPartialSessions === 'boolean'
                ? stored.logPartialSessions : DEFAULT_CONFIG.logPartialSessions,
            activityUpdateIntervalSeconds: numericOr(stored.activityUpdateIntervalSeconds, DEFAULT_CONFIG.activityUpdateIntervalSeconds, NUMERIC_BOUNDS.activityUpdateIntervalSeconds.min, NUMERIC_BOUNDS.activityUpdateIntervalSeconds.max)
        };
        logger$8.debug('Loaded session config', config);
        return config;
    }
    catch (error) {
        logger$8.error('Error loading session config', error);
        return DEFAULT_CONFIG;
    }
}
/**
 * Coerce a stored value to a number within bounds, or fall back
 */
function numericOr(value, fallback, min, max) {
    const num = Number(value);
    return Number.isFinite(num) && num >= min && num <= max ? num : fallback;
}
/**
 * Convert configuration to milliseconds for internal use
 */
function getConfigurationInMs(config) {
    return {
        idleThreshold: config.idleThresholdMinutes * 60 * 1000,
        minSessionDuration: config.minSessionDurationSeconds * 1000,
        activityUpdateInterval: config.activityUpdateIntervalSeconds * 1000,
        requireContinuousActivity: config.requireContinuousActivity,
        logPartialSessions: config.logPartialSessions
    };
}

// session-service.ts
const logger$7 = loguru.getLogger('session-service');
// MV3 service workers are terminated after ~30s idle; session state is
// checkpointed into chrome.storage.session on every heartbeat and restored
// on worker startup so sessions survive worker restarts
const CHECKPOINT_KEY = 'activeSessionCheckpoint';
const PENDING_WRITES_KEY = 'pendingSessionWrites';
// Bounds for the end-of-session write retry queue
const MAX_WRITE_ATTEMPTS = 3;
const MAX_QUEUE_SIZE = 50;
class SessionService {
    /**
     * Create a new session service
     */
    constructor(paperManager, config) {
        this.paperManager = paperManager;
        this.activeSession = null;
        this.timeoutId = null;
        this.paperMetadata = new Map();
        // Bounded retry queue for end-of-session GitHub writes
        this.pendingWrites = [];
        this.flushing = false;
        this.config = config ?? getConfigurationInMs(DEFAULT_CONFIG);
        logger$7.debug('Session service initialized');
    }
    /**
     * Apply updated session configuration (idle threshold, min duration, etc.)
     */
    updateConfig(config) {
        this.config = config;
        if (this.activeSession) {
            this.scheduleTimeoutCheck();
        }
        logger$7.debug('Session config updated', config);
    }
    /**
     * Swap the paper manager used for session writes (credential changes).
     * Keeping the same service instance preserves the active session, any
     * checkpoint, and queued writes; a null manager just parks the queue.
     */
    setPaperManager(paperManager) {
        this.paperManager = paperManager;
        logger$7.debug('Paper manager updated', { hasManager: paperManager !== null });
    }
    // chrome.storage.session is only available to MV3 workers; without it we
    // degrade to the previous in-memory behavior
    getSessionStore() {
        try {
            return chrome.storage?.session ?? null;
        }
        catch {
            return null;
        }
    }
    /**
     * Start a new session for a paper
     */
    startSession(sourceId, paperId, metadata) {
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
            logger$7.debug(`Stored metadata for ${key}`);
        }
        // Start timeout check and checkpoint the new session so it can be
        // restored if the service worker is terminated
        this.scheduleTimeoutCheck();
        void this.persistCheckpoint();
        logger$7.info(`Started session for ${sourceId}:${paperId}`);
    }
    /**
     * Record a heartbeat for the current session
     */
    recordHeartbeat() {
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
            logger$7.debug(`Session received ${this.activeSession.heartbeatCount} heartbeats`);
        }
        return true;
    }
    /**
     * Restore checkpointed session state and queued writes after a worker restart.
     * Must be awaited (or at least invoked) during worker startup.
     */
    async restorePersistedState() {
        const store = this.getSessionStore();
        if (!store)
            return;
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
                    logger$7.info(`Restored ${this.pendingWrites.length} pending session write(s)`);
                }
            }
            const checkpoint = items[CHECKPOINT_KEY];
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
                    this.paperMetadata.set(`${checkpoint.sourceId}:${checkpoint.paperId}`, checkpoint.metadata);
                }
                logger$7.info(`Restored session for ${checkpoint.sourceId}:${checkpoint.paperId}`, {
                    heartbeatCount: checkpoint.heartbeatCount
                });
                // Heartbeats stopped while the worker was down: finalize the session
                // if the silence exceeds the idle threshold, otherwise keep it alive
                if (Date.now() - lastHeartbeatTime.getTime() > this.config.idleThreshold) {
                    this.checkTimeout();
                }
                else {
                    this.scheduleTimeoutCheck();
                }
            }
            void this.flushPendingWrites();
        }
        catch (error) {
            logger$7.error('Failed to restore session state', error);
        }
    }
    /**
     * Schedule a check for heartbeat timeout
     */
    scheduleTimeoutCheck() {
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
    checkTimeout() {
        if (!this.activeSession)
            return;
        const now = Date.now();
        const lastTime = this.activeSession.lastHeartbeatTime.getTime();
        if ((now - lastTime) > this.config.idleThreshold) {
            if (this.config.requireContinuousActivity) {
                logger$7.info('Session timeout detected');
                this.endSession();
            }
            else {
                // Continuous activity not required: keep the session alive across
                // idle gaps and keep checking
                this.scheduleTimeoutCheck();
            }
        }
        else {
            this.scheduleTimeoutCheck();
        }
    }
    /**
     * Whether a finished session is long enough to be logged, honoring the
     * configured minimum duration and partial-session flag
     */
    shouldLogSession(sessionData) {
        return sessionData.duration_seconds * 1000 >= this.config.minSessionDuration ||
            this.config.logPartialSessions;
    }
    /**
     * End the current session and get the data
     */
    endSession() {
        if (!this.activeSession)
            return null;
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
        const sessionData = {
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
        logger$7.info(`Ended session for ${sourceId}:${paperId}`, {
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
    queueSessionWrite(sourceId, paperId, sessionData, metadata) {
        if (this.pendingWrites.length >= MAX_QUEUE_SIZE) {
            logger$7.warning('Pending session write queue full, dropping oldest entry');
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
    async flushPendingWrites() {
        if (this.flushing || !this.paperManager)
            return;
        this.flushing = true;
        try {
            while (this.pendingWrites.length > 0) {
                const entry = this.pendingWrites[0];
                try {
                    await this.paperManager.logReadingSession(entry.sourceId, entry.paperId, entry.session, entry.metadata);
                    this.pendingWrites.shift();
                    await this.persistPendingWrites();
                }
                catch (error) {
                    entry.attempts++;
                    logger$7.error(`Failed to store session for ${entry.sourceId}:${entry.paperId} (attempt ${entry.attempts}/${MAX_WRITE_ATTEMPTS})`, error);
                    if (entry.attempts >= MAX_WRITE_ATTEMPTS) {
                        this.pendingWrites.shift();
                        await this.persistPendingWrites();
                    }
                    break;
                }
            }
        }
        finally {
            this.flushing = false;
        }
    }
    /**
     * Mirror the write queue into chrome.storage.session so it survives
     * service worker restarts
     */
    async persistPendingWrites() {
        const store = this.getSessionStore();
        if (!store)
            return;
        try {
            await store.set({ [PENDING_WRITES_KEY]: this.pendingWrites });
        }
        catch (error) {
            logger$7.error('Failed to persist pending session writes', error);
        }
    }
    /**
     * Checkpoint the active session into chrome.storage.session so it can be
     * restored after the MV3 worker is killed
     */
    async persistCheckpoint() {
        const store = this.getSessionStore();
        if (!store || !this.activeSession)
            return;
        const checkpoint = {
            sourceId: this.activeSession.sourceId,
            paperId: this.activeSession.paperId,
            startTime: this.activeSession.startTime.toISOString(),
            heartbeatCount: this.activeSession.heartbeatCount,
            lastHeartbeatTime: this.activeSession.lastHeartbeatTime.toISOString(),
            metadata: this.getPaperMetadata(this.activeSession.sourceId, this.activeSession.paperId)
        };
        try {
            await store.set({ [CHECKPOINT_KEY]: checkpoint });
        }
        catch (error) {
            logger$7.error('Failed to persist session checkpoint', error);
        }
    }
    async clearCheckpoint() {
        const store = this.getSessionStore();
        if (!store)
            return;
        try {
            await store.remove(CHECKPOINT_KEY);
        }
        catch (error) {
            logger$7.error('Failed to clear session checkpoint', error);
        }
    }
    isValidCheckpoint(value) {
        if (typeof value !== 'object' || value === null)
            return false;
        const checkpoint = value;
        return (typeof checkpoint.sourceId === 'string' && checkpoint.sourceId.length > 0 &&
            typeof checkpoint.paperId === 'string' && checkpoint.paperId.length > 0 &&
            typeof checkpoint.heartbeatCount === 'number' && Number.isFinite(checkpoint.heartbeatCount) &&
            checkpoint.heartbeatCount >= 0 &&
            typeof checkpoint.startTime === 'string' && !Number.isNaN(new Date(checkpoint.startTime).getTime()) &&
            typeof checkpoint.lastHeartbeatTime === 'string' &&
            !Number.isNaN(new Date(checkpoint.lastHeartbeatTime).getTime()));
    }
    isValidPendingWrite(value) {
        if (typeof value !== 'object' || value === null)
            return false;
        const entry = value;
        return (typeof entry.sourceId === 'string' &&
            typeof entry.paperId === 'string' &&
            typeof entry.attempts === 'number' &&
            entry.attempts < MAX_WRITE_ATTEMPTS &&
            typeof entry.session === 'object' && entry.session !== null &&
            typeof entry.session.session_id === 'string');
    }
    /**
     * Check if a session is currently active
     */
    hasActiveSession() {
        return this.activeSession !== null;
    }
    /**
     * Get information about the current session
     */
    getCurrentSession() {
        if (!this.activeSession)
            return null;
        return {
            sourceId: this.activeSession.sourceId,
            paperId: this.activeSession.paperId
        };
    }
    /**
     * Get paper metadata for the current or specified session
     */
    getPaperMetadata(sourceId, paperId) {
        if (!sourceId || !paperId) {
            if (!this.activeSession)
                return undefined;
            sourceId = this.activeSession.sourceId;
            paperId = this.activeSession.paperId;
        }
        return this.paperMetadata.get(`${sourceId}:${paperId}`);
    }
    /**
     * Store paper metadata
     */
    storePaperMetadata(metadata) {
        const key = `${metadata.sourceId}:${metadata.paperId}`;
        this.paperMetadata.set(key, metadata);
    }
    /**
     * Get time since last heartbeat in milliseconds
     */
    getTimeSinceLastHeartbeat() {
        if (!this.activeSession) {
            return null;
        }
        return Date.now() - this.activeSession.lastHeartbeatTime.getTime();
    }
    /**
     * Get session statistics for debugging
     */
    getSessionStats() {
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

// extension/utils/popup-manager.ts
const logger$6 = loguru.getLogger('popup-manager');
/**
 * Manages all popup-related functionality
 */
class PopupManager {
    /**
     * Create a new popup manager
     */
    constructor(sourceManagerProvider, paperManagerProvider) {
        this.sourceManagerProvider = sourceManagerProvider;
        this.paperManagerProvider = paperManagerProvider;
        this.setupMessageListeners();
        logger$6.debug('Popup manager initialized');
    }
    /**
     * Set up message listeners for popup-related messages
     */
    setupMessageListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // Handle popup actions (ratings, notes, etc.)
            if (message.type === 'popupAction') {
                this.handlePopupAction(message.sourceId, message.paperId, message.action, message.data).then(() => {
                    sendResponse({ success: true });
                }).catch(error => {
                    logger$6.error('Error handling popup action', error);
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                });
                return true; // Will respond asynchronously
            }
            // Handle request to show annotation popup
            if (message.type === 'showAnnotationPopup' && sender.tab?.id) {
                this.handleShowAnnotationPopup(sender.tab.id, message.sourceId, message.paperId, message.position).then(() => {
                    sendResponse({ success: true });
                }).catch(error => {
                    logger$6.error('Error showing popup', error);
                    sendResponse({
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                });
                return true; // Will respond asynchronously
            }
            return false; // Not handled
        });
    }
    /**
     * Handle a request to show an annotation popup
     */
    async handleShowAnnotationPopup(tabId, sourceId, paperId, position) {
        logger$6.debug(`Showing annotation popup for ${sourceId}:${paperId}`);
        // Check if we have source and paper manager
        const sourceManager = this.sourceManagerProvider();
        const paperManager = this.paperManagerProvider();
        if (!sourceManager) {
            throw new Error('Source manager not initialized');
        }
        if (!paperManager) {
            throw new Error('Paper manager not initialized');
        }
        try {
            // Get paper data (fall back to a stub if not yet stored)
            const paper = await paperManager.getPaper(sourceId, paperId) || {
                sourceId,
                paperId,
                title: paperId,
                authors: '',
                abstract: '',
                url: '',
                timestamp: new Date().toISOString(),
                publishedDate: '',
                tags: [],
                rating: 'novote'
            };
            // Get handlers
            const handlers = this.getStandardPopupHandlers();
            // Send structured paper data to content script to show popup
            const message = {
                type: 'showPopup',
                sourceId,
                paperId,
                paper,
                handlers,
                position
            };
            await chrome.tabs.sendMessage(tabId, message);
            logger$6.debug(`Sent popup to content script for ${sourceId}:${paperId}`);
        }
        catch (error) {
            logger$6.error(`Error showing popup for ${sourceId}:${paperId}`, error);
            throw error;
        }
    }
    /**
     * Handle popup actions (ratings, notes, etc.)
     */
    async handlePopupAction(sourceId, paperId, action, data) {
        const paperManager = this.paperManagerProvider();
        if (!paperManager) {
            throw new Error('Paper manager not initialized');
        }
        logger$6.debug(`Handling popup action: ${action}`, { sourceId, paperId });
        try {
            if (action === 'rate') {
                await paperManager.updateRating(sourceId, paperId, data.value);
                logger$6.info(`Updated rating for ${sourceId}:${paperId} to ${data.value}`);
            }
            else if (action === 'saveNotes') {
                if (data.value) {
                    await paperManager.logAnnotation(sourceId, paperId, 'notes', data.value);
                    logger$6.info(`Saved notes for ${sourceId}:${paperId}`);
                }
            }
        }
        catch (error) {
            logger$6.error(`Error handling action ${action} for ${sourceId}:${paperId}`, error);
            throw error;
        }
    }
    /**
     * Get standard popup event handlers
     */
    getStandardPopupHandlers() {
        return [
            { selector: '#btn-thumbsup', event: 'click', action: 'rate' },
            { selector: '#btn-thumbsdown', event: 'click', action: 'rate' },
            { selector: '#btn-save', event: 'click', action: 'saveNotes' }
        ];
    }
}

// extension/source-integration/source-manager.ts
const logger$5 = loguru.getLogger('source-manager');
/**
 * Manages source integrations
 */
class SourceIntegrationManager {
    constructor() {
        this.sources = new Map();
        logger$5.info('Source integration manager initialized');
    }
    /**
     * Register a source integration
     */
    registerSource(source) {
        if (this.sources.has(source.id)) {
            logger$5.warning(`Source with ID '${source.id}' already registered, overwriting`);
        }
        this.sources.set(source.id, source);
        logger$5.info(`Registered source: ${source.name} (${source.id})`);
    }
    /**
     * Get all registered sources
     */
    getAllSources() {
        return Array.from(this.sources.values());
    }
    /**
     * Get source that can handle a URL
     */
    getSourceForUrl(url) {
        for (const source of this.sources.values()) {
            if (source.canHandleUrl(url)) {
                logger$5.debug(`Found source for URL '${url}': ${source.id}`);
                return source;
            }
        }
        logger$5.debug(`No source found for URL: ${url}`);
        return null;
    }
    /**
     * Get source by ID
     */
    getSourceById(sourceId) {
        const source = this.sources.get(sourceId);
        return source || null;
    }
    /**
     * Extract paper ID from URL using appropriate source
     */
    extractPaperId(url) {
        for (const source of this.sources.values()) {
            if (source.canHandleUrl(url)) {
                const paperId = source.extractPaperId(url);
                if (paperId) {
                    logger$5.debug(`Extracted paper ID '${paperId}' from URL using ${source.id}`);
                    return { sourceId: source.id, paperId };
                }
            }
        }
        logger$5.debug(`Could not extract paper ID from URL: ${url}`);
        return null;
    }
    /**
     * Format a paper identifier using the appropriate source
     */
    formatPaperId(sourceId, paperId) {
        const source = this.sources.get(sourceId);
        if (source) {
            return source.formatPaperId(paperId);
        }
        // Fallback if source not found
        logger$5.warning(`Source '${sourceId}' not found, using default format for paper ID`);
        return `${sourceId}.${paperId}`;
    }
    /**
     * Format an object ID using the appropriate source
     */
    formatObjectId(type, sourceId, paperId) {
        const source = this.sources.get(sourceId);
        if (source) {
            return source.formatObjectId(type, paperId);
        }
        // Fallback if source not found
        logger$5.warning(`Source '${sourceId}' not found, using default format for object ID`);
        return `${type}:${sourceId}.${paperId}`;
    }
    /**
     * Get all content script match patterns
     */
    getAllContentScriptMatches() {
        const patterns = [];
        for (const source of this.sources.values()) {
            patterns.push(...source.contentScriptMatches);
        }
        return patterns;
    }
}

// extension/source-integration/metadata-extractor.ts
const logger$4 = loguru.getLogger('metadata-extractor');
// Constants for standard source types
const SOURCE_TYPES = {
    PDF: 'pdf',
    URL: 'url',
};
/**
 * Base class for metadata extraction with customizable extraction methods
 * Each method can be overridden to provide source-specific extraction
 */
class MetadataExtractor {
    /**
     * Create a new metadata extractor for a document
     */
    constructor(document) {
        this.document = document;
        this.url = document.location.href;
        logger$4.debug('Initialized metadata extractor for:', this.url);
    }
    /**
     * Helper method to get content from meta tags
     */
    getMetaContent(selector) {
        const element = this.document.querySelector(selector);
        return element ? element.getAttribute('content') || '' : '';
    }
    /**
     * Extract and return all metadata fields
     */
    extract() {
        logger$4.debug('Extracting metadata from page:', this.url);
        const metadata = {
            title: this.extractTitle(),
            authors: this.extractAuthors(),
            description: this.extractDescription(),
            publishedDate: this.extractPublishedDate(),
            doi: this.extractDoi(),
            journalName: this.extractJournalName(),
            tags: this.extractTags(),
            url: this.url
        };
        logger$4.debug('Metadata extraction complete:', metadata);
        return metadata;
    }
    /**
     * Extract title from document
     * Considers multiple metadata standards with priority order
     */
    extractTitle() {
        // Title extraction - priority order
        return (
        // Dublin Core
        this.getMetaContent('meta[name="DC.Title"]') || this.getMetaContent('meta[name="dc.title"]') ||
            // Citation
            this.getMetaContent('meta[name="citation_title"]') ||
            // Open Graph
            this.getMetaContent('meta[property="og:title"]') ||
            // Standard meta
            this.getMetaContent('meta[name="title"]') ||
            // Fallback to document title
            this.document.title);
    }
    /**
     * Extract authors from document
     * Handles multiple author formats and sources
     */
    extractAuthors() {
        // Get all citation authors (some pages have multiple citation_author tags)
        const citationAuthors = [];
        this.document.querySelectorAll('meta[name="citation_author"]').forEach(el => {
            const content = el.getAttribute('content');
            if (content)
                citationAuthors.push(content);
        });
        // Get all DC creators
        const dcCreators = [];
        this.document.querySelectorAll('meta[name="DC.Creator.PersonalName"]').forEach(el => {
            const content = el.getAttribute('content');
            if (content)
                dcCreators.push(content);
        });
        // Individual author elements
        const dcCreator = this.getMetaContent('meta[name="DC.Creator.PersonalName"]') || this.getMetaContent('meta[name="dc.creator.personalname"]');
        const citationAuthor = this.getMetaContent('meta[name="citation_author"]');
        const ogAuthor = this.getMetaContent('meta[property="og:article:author"]') ||
            this.getMetaContent('meta[name="author"]');
        // Set authors with priority
        if (dcCreators.length > 0) {
            return dcCreators.join(', ');
        }
        else if (citationAuthors.length > 0) {
            return citationAuthors.join(', ');
        }
        else if (dcCreator) {
            return dcCreator;
        }
        else if (citationAuthor) {
            return citationAuthor;
        }
        else if (ogAuthor) {
            return ogAuthor;
        }
        return '';
    }
    /**
     * Extract description/abstract from document
     */
    extractDescription() {
        return (this.getMetaContent('meta[name="DC.Description"]') || this.getMetaContent('meta[name="dc.description"]') ||
            this.getMetaContent('meta[name="citation_abstract"]') ||
            this.getMetaContent('meta[property="og:description"]') ||
            this.getMetaContent('meta[name="description"]'));
    }
    /**
     * Extract publication date from document
     */
    extractPublishedDate() {
        return (this.getMetaContent('meta[name="DC.Date.issued"]') || this.getMetaContent('meta[name="dc.date.issued"]') || this.getMetaContent('meta[name="dc.date"]') || this.getMetaContent('meta[name="dc.Date"]') || this.getMetaContent('meta[name="DC.Date"]') ||
            this.getMetaContent('meta[name="citation_date"]') ||
            this.getMetaContent('meta[property="article:published_time"]'));
    }
    /**
     * Extract DOI (Digital Object Identifier) from document
     */
    extractDoi() {
        return (this.getMetaContent('meta[name="DC.Identifier.DOI"]') || this.getMetaContent('meta[name="dc.identifier.doi"]') ||
            this.getMetaContent('meta[name="citation_doi"]'));
    }
    /**
     * Extract journal name from document
     */
    extractJournalName() {
        return (this.getMetaContent('meta[name="DC.Source"]') || this.getMetaContent('meta[name="dc.source"]') ||
            this.getMetaContent('meta[name="citation_journal_title"]'));
    }
    /**
     * Extract keywords/tags from document
     */
    extractTags() {
        const keywords = this.getMetaContent('meta[name="keywords"]') ||
            this.getMetaContent('meta[name="DC.Subject"]') || this.getMetaContent('meta[name="dc.subject"]');
        if (keywords) {
            return keywords.split(',').map(tag => tag.trim());
        }
        return [];
    }
    /**
     * Determine if the current URL is a PDF
     */
    isPdf() {
        return isPdfUrl(this.url);
    }
    /**
     * Get the source type (PDF or URL)
     */
    getSourceType() {
        return this.isPdf() ? SOURCE_TYPES.PDF : SOURCE_TYPES.URL;
    }
    /**
     * Generate a paper ID for the current URL
     */
    generatePaperId() {
        return generatePaperIdFromUrl(this.url);
    }
}
/**
 * Create a common metadata extractor for a document
 * Factory function for creating the default extractor
 */
function createMetadataExtractor(document) {
    return new MetadataExtractor(document);
}
/**
 * Generate a paper ID from a URL
 * Creates a consistent hash-based identifier
 */
function generatePaperIdFromUrl(url) {
    // Use a basic hash function to create an ID from the URL
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        const char = url.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // Create a positive hexadecimal string
    const positiveHash = Math.abs(hash).toString(16).toUpperCase();
    // Use the first 8 characters as the ID
    return positiveHash.substring(0, 8);
}
/**
 * Determine if a URL is a PDF
 */
function isPdfUrl(url) {
    return url.toLowerCase().endsWith('.pdf');
}

// extension/source-integration/base-source.ts
const logger$3 = loguru.getLogger('base-source');
/**
 * Base class for source integrations
 * Provides default implementations for all methods
 * Specific sources can override as needed
 */
class BaseSourceIntegration {
    constructor() {
        // Default properties - set for generic web pages
        this.id = 'url';
        this.name = 'Web Page';
        // Hostnames this integration accepts (exact match or subdomain).
        // Must be declared per source; an empty list means no URLs are accepted.
        this.allowedHosts = [];
        // Path patterns for paper URLs, anchored to the parsed URL's pathname
        this.urlPatterns = [];
        this.contentScriptMatches = [];
    }
    /**
     * Parse a URL and reject anything that is not a well-formed http(s) URL
     * Shared entry point for URL validation across source integrations
     */
    parseHttpUrl(url) {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                return null;
            }
            return parsed;
        }
        catch {
            return null;
        }
    }
    /**
     * Check a lowercase hostname against the allowlist (subdomains included)
     */
    isAllowedHost(hostname) {
        return this.allowedHosts.some(allowed => hostname === allowed || hostname.endsWith(`.${allowed}`));
    }
    /**
     * Check if this integration can handle the given URL
     * Only well-formed http(s) URLs on explicitly allowed hosts match
     */
    canHandleUrl(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed) {
            return false;
        }
        return this.isAllowedHost(parsed.hostname.toLowerCase()) &&
            this.urlPatterns.some(pattern => pattern.test(parsed.pathname));
    }
    /**
     * Extract paper ID from URL
     * Default implementation creates a hash from the URL
     */
    extractPaperId(url) {
        return generatePaperIdFromUrl(url);
    }
    /**
     * Create a metadata extractor for the given document
     * Override this method to provide a custom extractor for your source
     */
    createMetadataExtractor(document) {
        return createMetadataExtractor(document);
    }
    /**
     * Extract metadata from a page
     * Default implementation uses common metadata extraction
     */
    async extractMetadata(document, paperId) {
        try {
            logger$3.debug(`Extracting metadata using base extractor for ID: ${paperId}`);
            // Create a metadata extractor for this document
            const extractor = this.createMetadataExtractor(document);
            // Extract metadata
            const extracted = extractor.extract();
            const url = document.location.href;
            // Determine source type (PDF or URL)
            const sourceType = extractor.getSourceType();
            // Create PaperMetadata object
            return {
                sourceId: this.id,
                //paperId: this.formatPaperId(paperId),
                paperId: paperId,
                url: url,
                title: extracted.title || document.title || paperId,
                authors: extracted.authors || '',
                abstract: extracted.description || '',
                timestamp: new Date().toISOString(),
                rating: 'novote',
                publishedDate: extracted.publishedDate || '',
                tags: extracted.tags || [],
                doi: extracted.doi,
                journalName: extracted.journalName,
                sourceType: sourceType // Store the source type for reference
            };
        }
        catch (error) {
            logger$3.error('Error extracting metadata with base extractor', error);
            return null;
        }
    }
    /**
     * Format a paper identifier for this source
     * Default implementation uses the format: sourceId.paperId
     */
    formatPaperId(paperId) {
        return `${this.id}.${paperId}`;
    }
    /**
     * Parse a paper identifier specific to this source
     * Default implementation handles source.paperId format and extracts paperId
     */
    parsePaperId(identifier) {
        const prefix = `${this.id}.`;
        if (identifier.startsWith(prefix)) {
            return identifier.substring(prefix.length);
        }
        // Try legacy format (sourceId:paperId)
        const legacyPrefix = `${this.id}:`;
        if (identifier.startsWith(legacyPrefix)) {
            logger$3.debug(`Parsed legacy format identifier: ${identifier}`);
            return identifier.substring(legacyPrefix.length);
        }
        return null;
    }
    /**
     * Format a storage object ID for this source
     * Default implementation uses the format: type:sourceId.paperId
     */
    formatObjectId(type, paperId) {
        return `${type}:${this.formatPaperId(paperId)}`;
    }
}

// extension/source-integration/arxiv/index.ts
const logger$2 = loguru.getLogger('arxiv-integration');
/**
 * Custom metadata extractor for arXiv pages
 */
class ArxivMetadataExtractor extends MetadataExtractor {
    constructor(document, apiMetadata) {
        super(document);
        this.apiMetadata = apiMetadata;
    }
    /**
     * Override title extraction to use API data if available
     */
    extractTitle() {
        if (this.apiMetadata?.title) {
            return this.apiMetadata.title;
        }
        return super.extractTitle();
    }
    /**
     * Override authors extraction to use API data if available
     */
    extractAuthors() {
        if (this.apiMetadata?.authors) {
            return this.apiMetadata.authors;
        }
        // arXiv-specific selectors
        const authorLinks = this.document.querySelectorAll('.authors a');
        if (authorLinks.length > 0) {
            return Array.from(authorLinks)
                .map(link => link.textContent?.trim())
                .filter(Boolean)
                .join(', ');
        }
        return super.extractAuthors();
    }
    /**
     * Override description extraction to use API data if available
     */
    extractDescription() {
        if (this.apiMetadata?.description) {
            return this.apiMetadata.description;
        }
        // arXiv-specific selectors
        const abstract = this.document.querySelector('.abstract')?.textContent?.trim();
        if (abstract) {
            // Remove "Abstract:" prefix if present
            return abstract.replace(/^Abstract:\s*/i, '');
        }
        return super.extractDescription();
    }
    /**
     * Override published date extraction to use API data if available
     */
    extractPublishedDate() {
        if (this.apiMetadata?.publishedDate) {
            return this.apiMetadata.publishedDate;
        }
        // arXiv-specific date extraction
        const datelineElement = this.document.querySelector('.dateline');
        if (datelineElement) {
            const dateText = datelineElement.textContent;
            const dateMatch = dateText?.match(/\(Submitted on ([^)]+)\)/);
            if (dateMatch) {
                return dateMatch[1];
            }
        }
        return super.extractPublishedDate();
    }
    /**
     * Override DOI extraction to use API data if available
     */
    extractDoi() {
        return this.apiMetadata?.doi || super.extractDoi();
    }
    /**
     * Override journal extraction to use API data if available
     */
    extractJournalName() {
        return this.apiMetadata?.journalName || super.extractJournalName();
    }
    /**
     * Override tags extraction to use API data if available
     */
    extractTags() {
        if (this.apiMetadata?.tags) {
            return this.apiMetadata.tags;
        }
        // arXiv-specific category extraction
        const subjects = this.document.querySelector('.subjects')?.textContent?.trim();
        if (subjects) {
            return subjects.split(/[;,]/).map(tag => tag.trim()).filter(Boolean);
        }
        return super.extractTags();
    }
}
/**
 * ArXiv integration with custom metadata extraction
 */
class ArXivIntegration extends BaseSourceIntegration {
    constructor() {
        super(...arguments);
        this.id = 'arxiv';
        this.name = 'arXiv.org';
        // Host allowlist: only well-formed http(s) URLs on arxiv.org are accepted
        this.allowedHosts = ['arxiv.org'];
        // Path patterns for papers, anchored to the parsed URL's pathname
        // (previously matched anywhere in the URL, which was spoofable)
        this.urlPatterns = [
            /^\/(abs|pdf|html)\/([0-9.]+)/,
            /^\/\w+\/([0-9.]+)/
        ];
        // Content script matches
        // readonly contentScriptMatches = [
        //   "*://*.arxiv.org/*"
        // ];
        // ArXiv API endpoint
        this.API_BASE_URL = 'https://export.arxiv.org/api/query';
    }
    /**
     * Extract paper ID from URL
     */
    extractPaperId(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed || !this.isAllowedHost(parsed.hostname.toLowerCase())) {
            return null;
        }
        for (const pattern of this.urlPatterns) {
            const match = parsed.pathname.match(pattern);
            if (match) {
                return match[2] || match[1]; // The capture group with the paper ID
            }
        }
        return null;
    }
    /**
     * Create a custom metadata extractor for arXiv
     */
    createMetadataExtractor(document) {
        return new ArxivMetadataExtractor(document);
    }
    /**
     * Fetch metadata from ArXiv API
     */
    async fetchFromApi(paperId) {
        try {
            const apiUrl = `${this.API_BASE_URL}?id_list=${paperId}`;
            logger$2.debug(`Fetching from ArXiv API: ${apiUrl}`);
            const response = await fetch(apiUrl);
            if (!response.ok) {
                logger$2.error(`ArXiv API request failed with status: ${response.status}`);
                return null;
            }
            const xmlText = await response.text();
            // Parse XML to JSON
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
            // Convert XML to a more manageable format
            const entry = xmlDoc.querySelector('entry');
            if (!entry) {
                logger$2.warn('No entry found in ArXiv API response');
                return null;
            }
            // Extract metadata from XML
            const title = entry.querySelector('title')?.textContent?.trim() || '';
            const summary = entry.querySelector('summary')?.textContent?.trim() || '';
            const published = entry.querySelector('published')?.textContent?.trim() || '';
            // Extract authors
            const authorElements = entry.querySelectorAll('author name');
            const authors = Array.from(authorElements)
                .map(el => el.textContent?.trim())
                .filter(Boolean)
                .join(', ');
            // Extract DOI if available
            const doi = entry.querySelector('arxiv\\:doi, doi')?.textContent?.trim();
            // Extract journal reference if available
            const journalRef = entry.querySelector('arxiv\\:journal_ref, journal_ref')?.textContent?.trim();
            // Extract categories
            const categoryElements = entry.querySelectorAll('category');
            const categories = Array.from(categoryElements)
                .map(el => el.getAttribute('term'))
                .filter(Boolean);
            return {
                title,
                authors,
                description: summary,
                publishedDate: published,
                doi,
                journalName: journalRef,
                tags: categories
            };
        }
        catch (error) {
            logger$2.error('Error fetching from ArXiv API', error);
            return null;
        }
    }
    /**
     * Extract metadata from page or fetch from API
     * Override parent method to handle the API fallback
     */
    async extractMetadata(document, paperId) {
        try {
            logger$2.info(`Extracting metadata for arXiv ID: ${paperId}`);
            // Try to extract from page first
            const extractor = this.createMetadataExtractor(document);
            const pageMetadata = extractor.extract();
            // Check if we have the essential fields
            const hasTitle = pageMetadata.title && pageMetadata.title !== document.title;
            const hasAuthors = pageMetadata.authors && pageMetadata.authors.length > 0;
            const hasAbstract = pageMetadata.description && pageMetadata.description.length > 0;
            if (hasTitle && hasAuthors && hasAbstract) {
                logger$2.debug('Successfully extracted complete metadata from page');
                return this.convertToPageMetadata(pageMetadata, paperId, extractor.getSourceType());
            }
            // If page extraction is incomplete, fetch from API
            logger$2.info('Page metadata incomplete, fetching from ArXiv API');
            const apiMetadata = await this.fetchFromApi(paperId);
            if (!apiMetadata) {
                logger$2.warn('Failed to fetch metadata from ArXiv API, using partial page data');
                return this.convertToPageMetadata(pageMetadata, paperId, extractor.getSourceType());
            }
            // Create a new extractor with API data
            const enhancedExtractor = new ArxivMetadataExtractor(document, apiMetadata);
            const mergedMetadata = enhancedExtractor.extract();
            logger$2.debug('Merged metadata from page and API', mergedMetadata);
            return this.convertToPageMetadata(mergedMetadata, paperId, enhancedExtractor.getSourceType());
        }
        catch (error) {
            logger$2.error('Error extracting metadata for arXiv', error);
            return null;
        }
    }
    /**
     * Convert ExtractedMetadata to PaperMetadata
     */
    convertToPageMetadata(extracted, paperId, sourceType) {
        return {
            sourceId: this.id,
            paperId: paperId,
            url: extracted.url || '',
            title: extracted.title,
            authors: extracted.authors,
            abstract: extracted.description,
            timestamp: new Date().toISOString(),
            rating: 'novote',
            publishedDate: extracted.publishedDate,
            tags: extracted.tags || [],
            doi: extracted.doi,
            journalName: extracted.journalName,
            sourceType: sourceType
        };
    }
}
// Export a singleton instance that can be used by both background and content scripts
const arxivIntegration = new ArXivIntegration();

// extension/source-integration/openreview/index.ts
const logger$1 = loguru.getLogger('openreview-integration');
/**
 * Custom metadata extractor for OpenReview pages
 */
class OpenReviewMetadataExtractor extends MetadataExtractor {
    /**
     * Extract metadata from OpenReview pages
     */
    extract() {
        // First try to extract using standard methods
        const baseMetadata = super.extract();
        try {
            // Get title from OpenReview-specific elements
            const title = this.document.querySelector('.citation_title')?.textContent ||
                this.document.querySelector('.forum-title h2')?.textContent;
            // Get authors
            const authorElements = Array.from(this.document.querySelectorAll('.forum-authors a'));
            const authors = authorElements
                .map(el => el.textContent)
                .filter(Boolean)
                .join(', ');
            // Get abstract
            const abstract = this.document.querySelector('meta[name="citation_abstract"]')?.getAttribute('content') ||
                Array.from(this.document.querySelectorAll('.note-content-field'))
                    .find(el => el.textContent?.includes('Abstract'))
                    ?.nextElementSibling?.textContent;
            // Get publication date
            const dateText = this.document.querySelector('.date.item')?.textContent;
            let publishedDate = '';
            if (dateText) {
                const dateMatch = dateText.match(/Published: ([^,]+)/);
                if (dateMatch) {
                    publishedDate = dateMatch[1];
                }
            }
            // Get DOI if available
            const doi = this.document.querySelector('meta[name="citation_doi"]')?.getAttribute('content') || '';
            // Get conference/journal name
            const venueElements = this.document.querySelectorAll('.forum-meta .item');
            let venue = '';
            for (let i = 0; i < venueElements.length; i++) {
                const el = venueElements[i];
                if (el.querySelector('.glyphicon-folder-open')) {
                    venue = el.textContent?.trim() || '';
                    break;
                }
            }
            // Get tags/keywords
            const keywordsElement = Array.from(this.document.querySelectorAll('.note-content-field'))
                .find(el => el.textContent?.includes('Keywords'));
            let tags = [];
            if (keywordsElement) {
                const keywordsValue = keywordsElement.nextElementSibling?.textContent;
                if (keywordsValue) {
                    tags = keywordsValue.split(',').map(tag => tag.trim());
                }
            }
            return {
                title: title || baseMetadata.title,
                authors: authors || baseMetadata.authors,
                description: abstract || baseMetadata.description,
                publishedDate: publishedDate || baseMetadata.publishedDate,
                doi: doi || baseMetadata.doi,
                journalName: venue || baseMetadata.journalName,
                tags: tags.length ? tags : baseMetadata.tags,
                url: this.url
            };
        }
        catch (error) {
            logger$1.error('Error during OpenReview-specific extraction', error);
            return baseMetadata;
        }
    }
}
/**
 * OpenReview integration with custom metadata extraction
 */
class OpenReviewIntegration extends BaseSourceIntegration {
    constructor() {
        super(...arguments);
        this.id = 'openreview';
        this.name = 'OpenReview';
        // Host allowlist: only well-formed http(s) URLs on openreview.net match
        this.allowedHosts = ['openreview.net'];
        // Path patterns for papers, anchored to the parsed URL's pathname; the
        // paper id travels in the query string (forum?id=...)
        this.urlPatterns = [
            /^\/forum$/,
            /^\/pdf$/
        ];
    }
    /**
     * Extract paper ID from URL
     */
    extractPaperId(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed || !this.isAllowedHost(parsed.hostname.toLowerCase())) {
            return null;
        }
        if (!this.urlPatterns.some(pattern => pattern.test(parsed.pathname))) {
            return null;
        }
        const id = parsed.searchParams.get('id');
        return id && /^[a-zA-Z0-9]+$/.test(id) ? id : null;
    }
    /**
     * Create a custom metadata extractor for OpenReview
     */
    createMetadataExtractor(document) {
        return new OpenReviewMetadataExtractor(document);
    }
    /**
     * Extract metadata from page
     * Override parent method to handle OpenReview-specific extraction
     */
    async extractMetadata(document, paperId) {
        logger$1.info(`Extracting metadata for OpenReview ID: ${paperId}`);
        // Extract metadata using our custom extractor
        const metadata = await super.extractMetadata(document, paperId);
        if (metadata) {
            // Add any OpenReview-specific metadata processing here
            logger$1.debug('Extracted metadata from OpenReview page');
            // Check if we're on a PDF page and adjust metadata accordingly
            if (document.location.href.includes('/pdf?id=')) {
                metadata.sourceType = 'pdf';
            }
        }
        return metadata;
    }
}
// Export a singleton instance that can be used by both background and content scripts
const openReviewIntegration = new OpenReviewIntegration();

// extension/source-integration/nature/index.ts
loguru.getLogger('nature-integration');
/**
 * Custom metadata extractor for Nature.com pages
 */
class NatureMetadataExtractor extends MetadataExtractor {
    /**
     * Override title extraction to use meta tag first
     */
    extractTitle() {
        const metaTitle = this.getMetaContent('meta[name="citation_title"]') ||
            this.getMetaContent('meta[property="og:title"]');
        return metaTitle || super.extractTitle();
    }
    /**
     * Override authors extraction to use meta tag first
     */
    extractAuthors() {
        const metaAuthors = this.getMetaContent('meta[name="citation_author"]');
        if (metaAuthors) {
            return metaAuthors;
        }
        // Fallback to HTML extraction
        const authorElements = this.document.querySelectorAll('.c-article-author-list__item');
        if (authorElements.length > 0) {
            return Array.from(authorElements)
                .map(el => el.textContent?.trim())
                .filter(Boolean)
                .join(', ');
        }
        return super.extractAuthors();
    }
    /**
     * Extract keywords/tags from document
     */
    extractTags() {
        const keywords = this.getMetaContent('meta[name="dc.subject"]');
        if (keywords) {
            return keywords.split(',').map(tag => tag.trim());
        }
        return [];
    }
    /**
     * Override description extraction to use meta tag first
     */
    extractDescription() {
        const metaDescription = this.getMetaContent('meta[name="description"]') ||
            this.getMetaContent('meta[property="og:description"]');
        return metaDescription || super.extractDescription();
    }
    /**
     * Override published date extraction to use meta tag
     */
    extractPublishedDate() {
        return this.getMetaContent('meta[name="citation_publication_date"]') || super.extractPublishedDate();
    }
    /**
     * Override DOI extraction to use meta tag
     */
    extractDoi() {
        return this.getMetaContent('meta[name="citation_doi"]') || super.extractDoi();
    }
}
/**
 * Nature.com integration with custom metadata extraction
 */
class NatureIntegration extends BaseSourceIntegration {
    constructor() {
        super(...arguments);
        this.id = 'nature';
        this.name = 'Nature';
        // Host allowlist: only well-formed http(s) URLs on nature.com match
        this.allowedHosts = ['nature.com'];
        // Path pattern for articles, anchored to the parsed URL's pathname with a
        // capture group for the ID
        this.urlPatterns = [
            /^\/articles\/([^/?#]+)/,
        ];
    }
    /**
     * Extract paper ID from URL
     */
    extractPaperId(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed || !this.isAllowedHost(parsed.hostname.toLowerCase())) {
            return null;
        }
        const match = parsed.pathname.match(this.urlPatterns[0]);
        return match ? match[1] : null;
    }
    /**
     * Create a custom metadata extractor for Nature.com
     */
    createMetadataExtractor(document) {
        return new NatureMetadataExtractor(document);
    }
}
// Export a singleton instance 
const natureIntegration = new NatureIntegration();

// extension/source-integration/pnas/index.ts
class PnasIntegration extends BaseSourceIntegration {
    constructor() {
        super(...arguments);
        this.id = 'pnas';
        this.name = 'PNAS';
        // Host allowlist: only well-formed http(s) URLs on pnas.org match
        this.allowedHosts = ['pnas.org'];
        // Path pattern for articles, anchored to the parsed URL's pathname
        this.urlPatterns = [
            /^\/doi\/10\.1073\/pnas\.([0-9]+)/
        ];
    }
    // Extract the numeric PNAS id from the anchored pathname
    extractPaperId(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed || !this.isAllowedHost(parsed.hostname.toLowerCase())) {
            return null;
        }
        const match = parsed.pathname.match(this.urlPatterns[0]);
        return match ? match[1] : null;
    }
}
const pnasIntegration = new PnasIntegration();

// extension/source-integration/misc/index.ts
class MiscIntegration extends BaseSourceIntegration {
    constructor() {
        super(...arguments);
        this.id = 'url-misc';
        this.name = 'misc tracked url';
        this.urlPatterns = []; // set this empty to disable attaching the content injection icon thing
        // add URLs here to track
        this.contentScriptMatches = [
            "sciencedirect.com/science/article/",
            "philpapers.org/rec/",
            "proceedings.neurips.cc/paper_files/paper/",
            "journals.sagepub.com/doi/",
            "link.springer.com/article/",
            ".science.org/doi/",
            "journals.aps.org/prx/abstract/",
            "onlinelibrary.wiley.com/doi/",
            "cell.com/trends/cognitive-sciences/fulltext/",
            "researchgate.net/publication/",
            "psycnet.apa.org/record/",
            "biorxiv.org/content/",
            "osf.io/preprints/",
            "frontiersin.org/journals/",
            "jstor.org/",
            "proceedings.mlr.press/",
            "journals.plos.org/plosone/article",
            "ieeexplore.ieee.org/document/",
            "royalsocietypublishing.org/doi/",
            "papers.nips.cc/paper_files/paper/",
            "philarchive.org/archive/",
            "tandfonline.com/doi/",
            "iopscience.iop.org/article/",
            "academic.oup.com/brain/article/",
            "elifesciences.org/articles/",
            "escholarship.org/content/",
            "pmc.ncbi.nlm.nih.gov/articles/",
            "pubmed.ncbi.nlm.nih.gov/",
            "openaccess.thecvf.com/content/",
            "zenodo.org/records/",
            "journals.asm.org/doi/full/",
            "physoc.onlinelibrary.wiley.com/doi/full/",
            "storage.courtlistener.com/recap/",
            "bmj.com/content/",
            "ntsb.gov/investigations/pages",
            "ntsb.gov/investigations/AccidentReports",
            "aclanthology.org/",
            "journals.ametsoc.org/view/journals/",
            "substack.com/p/",
            "citeseerx.",
            "/doi/",
            "/pdf/",
        ];
        // Host allowlist derived from the substring patterns above. Each entry
        // pins the pattern to an explicit host (subdomains included) and, where
        // the original pattern had a meaningful path, an anchored path prefix.
        // The bare "/doi/" and "/pdf/" substrings were dropped: they matched any
        // host and could be spoofed via query strings; every publisher they
        // covered is listed explicitly here.
        this.trackedHosts = [
            { host: 'sciencedirect.com', pathPrefix: '/science/article/' },
            { host: 'philpapers.org', pathPrefix: '/rec/' },
            { host: 'proceedings.neurips.cc', pathPrefix: '/paper_files/paper/' },
            { host: 'journals.sagepub.com', pathPrefix: '/doi/' },
            { host: 'link.springer.com', pathPrefix: '/article/' },
            { host: 'science.org', pathPrefix: '/doi/' },
            { host: 'journals.aps.org', pathPrefix: '/prx/abstract/' },
            { host: 'onlinelibrary.wiley.com', pathPrefix: '/doi/' },
            { host: 'physoc.onlinelibrary.wiley.com', pathPrefix: '/doi/full/' },
            { host: 'cell.com', pathPrefix: '/trends/cognitive-sciences/fulltext/' },
            { host: 'researchgate.net', pathPrefix: '/publication/' },
            { host: 'psycnet.apa.org', pathPrefix: '/record/' },
            { host: 'biorxiv.org', pathPrefix: '/content/' },
            { host: 'osf.io', pathPrefix: '/preprints/' },
            { host: 'frontiersin.org', pathPrefix: '/journals/' },
            { host: 'jstor.org' },
            { host: 'proceedings.mlr.press' },
            { host: 'journals.plos.org', pathPrefix: '/plosone/article' },
            { host: 'ieeexplore.ieee.org', pathPrefix: '/document/' },
            { host: 'royalsocietypublishing.org', pathPrefix: '/doi/' },
            { host: 'papers.nips.cc', pathPrefix: '/paper_files/paper/' },
            { host: 'philarchive.org', pathPrefix: '/archive/' },
            { host: 'tandfonline.com', pathPrefix: '/doi/' },
            { host: 'iopscience.iop.org', pathPrefix: '/article/' },
            { host: 'academic.oup.com', pathPrefix: '/brain/article/' },
            { host: 'elifesciences.org', pathPrefix: '/articles/' },
            { host: 'escholarship.org', pathPrefix: '/content/' },
            { host: 'pmc.ncbi.nlm.nih.gov', pathPrefix: '/articles/' },
            { host: 'pubmed.ncbi.nlm.nih.gov' },
            { host: 'openaccess.thecvf.com', pathPrefix: '/content/' },
            { host: 'zenodo.org', pathPrefix: '/records/' },
            { host: 'journals.asm.org', pathPrefix: '/doi/full/' },
            { host: 'storage.courtlistener.com', pathPrefix: '/recap/' },
            { host: 'bmj.com', pathPrefix: '/content/' },
            { host: 'ntsb.gov', pathPrefix: '/investigations/' },
            { host: 'aclanthology.org' },
            { host: 'journals.ametsoc.org', pathPrefix: '/view/journals/' },
            { host: 'substack.com', pathPrefix: '/p/' },
            { host: 'citeseerx.ist.psu.edu' },
        ];
    }
    canHandleUrl(url) {
        const parsed = this.parseHttpUrl(url);
        if (!parsed) {
            return false;
        }
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname;
        return this.trackedHosts.some(entry => (hostname === entry.host || hostname.endsWith(`.${entry.host}`)) &&
            (!entry.pathPrefix || pathname.startsWith(entry.pathPrefix)));
    }
}
const miscIntegration = new MiscIntegration();

// extension/source-integration/registry.ts
const sourceIntegrations = [
    arxivIntegration,
    openReviewIntegration,
    natureIntegration,
    pnasIntegration,
    miscIntegration,
];

// background.ts
const logger = loguru.getLogger('background');
const DEV_BUILD = false === true;
// Global state
let githubToken = '';
let githubRepo = '';
let paperManager = null;
let sessionService = null;
let popupManager = null;
let sourceManager = null;
// Message validation limits and allowlists
const MAX_STRING_LENGTH = 10000;
const MAX_ID_LENGTH = 512;
const MAX_REASON_LENGTH = 200;
const MAX_TAG_COUNT = 50;
const MAX_TAG_LENGTH = 100;
const VALID_RATINGS = ['novote', 'thumbsup', 'thumbsdown'];
// Initialize sources
function initializeSources() {
    sourceManager = new SourceIntegrationManager();
    // Register all sources from the central registry
    for (const integration of sourceIntegrations) {
        sourceManager.registerSource(integration);
    }
    logger.info('Source manager initialized with integrations:', sourceIntegrations.map(int => int.id).join(', '));
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
            const migrated = {};
            if (!githubToken && legacyToken)
                migrated.githubToken = legacyToken;
            if (!githubRepo && legacyRepo)
                migrated.githubRepo = legacyRepo;
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
            const githubClient = new d(githubToken, githubRepo);
            // Pass the source manager to the paper manager
            paperManager = new PaperManager(githubClient, sourceManager);
            logger.info('Paper manager initialized');
            // Initialize session service with paper manager
            sessionService = new SessionService(paperManager);
        }
        else {
            // Initialize session service without paper manager
            sessionService = new SessionService(null);
        }
        // Apply user-configured session settings and restore any session that
        // was checkpointed before the service worker was terminated
        await applySessionConfig();
        await sessionService.restorePersistedState();
        logger.info('Session service initialized');
        // Initialize popup manager
        popupManager = new PopupManager(() => sourceManager, () => paperManager);
        logger.info('Popup manager initialized');
        // Set up message listeners
        setupMessageListeners();
        // Initialize debug objects (development builds only)
        if (DEV_BUILD) ;
    }
    catch (error) {
        logger.error('Initialization error', error);
    }
}
// Load the saved session configuration and hand it to the session service
async function applySessionConfig() {
    try {
        const rawConfig = await loadSessionConfig();
        sessionService?.updateConfig(getConfigurationInMs(rawConfig));
    }
    catch (error) {
        logger.error('Failed to apply session config', error);
    }
}
// Set up message listeners
function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
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
function toErrorResponse(error) {
    return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Plain string within the message size cap
function isBoundedString(value, maxLength = MAX_STRING_LENGTH) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}
// Non-empty string within the message size cap
function isValidId(value) {
    return typeof value === 'string' && value.length > 0 &&
        value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9._~-]+$/.test(value);
}
function isValidRating(value) {
    return typeof value === 'string' && VALID_RATINGS.includes(value);
}
// Identifiers feed storage object IDs (sourceId.paperId) and metadata keys
// (sourceId:paperId), so the charset is kept separator-free. No registry
// check here: the 'url' fallback source is intentionally not registered in
// the background but still produces valid sessions from content scripts.
function resolveSourceAndPaper(sourceId, paperId) {
    if (!isValidId(sourceId) || !isValidId(paperId)) {
        return null;
    }
    return { sourceId, paperId };
}
function parseRuntimeMessage(raw) {
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
function textOr(value, fallback, maxLength = MAX_STRING_LENGTH) {
    return isBoundedString(value, maxLength) || (typeof value === 'string' && value.length === 0)
        ? value
        : fallback;
}
// Optional text field: present only when a bounded non-empty string
function optionalText(value, maxLength = MAX_STRING_LENGTH) {
    return isBoundedString(value, maxLength) ? value : undefined;
}
// Rebuild untrusted metadata into a well-formed PaperMetadata so unknown
// fields are dropped instead of persisted to GitHub
function sanitizePaperMetadata(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (!isValidId(value.sourceId) || !isValidId(value.paperId) || !isBoundedString(value.url)) {
        return null;
    }
    const tags = Array.isArray(value.tags)
        ? value.tags
            .filter((tag) => isBoundedString(tag, MAX_TAG_LENGTH))
            .slice(0, MAX_TAG_COUNT)
        : [];
    const metadata = {
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
async function handlePaperLog(metadata, context) {
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
async function handleUpdateRating(rating) {
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
function handleStartSession(sourceId, paperId) {
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
function handleEndSession(sourceId, paperId, reason) {
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
        const githubClient = new d(githubToken, githubRepo);
        paperManager = new PaperManager(githubClient, sourceManager);
        logger.info('Paper manager reinitialized');
    }
    else {
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
    self.__DEBUG__ = {
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
//# sourceMappingURL=background.bundle.js.map
