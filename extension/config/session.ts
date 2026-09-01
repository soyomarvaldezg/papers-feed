// config/session.ts
// Session configuration management

import { RawSessionConfig, SessionConfig } from './types';
import { loguru } from '../utils/logger';

const logger = loguru.getLogger('session-config');

// Sane bounds for numeric settings; values outside these ranges are rejected
// on save and fall back to defaults on load
const NUMERIC_BOUNDS = {
    idleThresholdMinutes: { min: 1, max: 60 },
    minSessionDurationSeconds: { min: 1, max: 300 },
    activityUpdateIntervalSeconds: { min: 1, max: 60 }
} as const;

function isFiniteInBounds(value: number, min: number, max: number): boolean {
    return Number.isFinite(value) && value >= min && value <= max;
}

// Default configuration values
export const DEFAULT_CONFIG: RawSessionConfig = {
    idleThresholdMinutes: 5,
    minSessionDurationSeconds: 30,
    requireContinuousActivity: true,  // If true, resets timer on idle
    logPartialSessions: false,        // If true, logs sessions even if under minimum duration
    activityUpdateIntervalSeconds: 1  // How often to update active time
};

/**
 * Load session configuration from storage
 */
export async function loadSessionConfig(): Promise<RawSessionConfig> {
    try {
        const items = await chrome.storage.sync.get('sessionConfig');
        const stored = (items.sessionConfig ?? {}) as Partial<RawSessionConfig>;
        const config: RawSessionConfig = {
            idleThresholdMinutes: numericOr(
                stored.idleThresholdMinutes,
                DEFAULT_CONFIG.idleThresholdMinutes,
                NUMERIC_BOUNDS.idleThresholdMinutes.min,
                NUMERIC_BOUNDS.idleThresholdMinutes.max
            ),
            minSessionDurationSeconds: numericOr(
                stored.minSessionDurationSeconds,
                DEFAULT_CONFIG.minSessionDurationSeconds,
                NUMERIC_BOUNDS.minSessionDurationSeconds.min,
                NUMERIC_BOUNDS.minSessionDurationSeconds.max
            ),
            requireContinuousActivity:
                typeof stored.requireContinuousActivity === 'boolean'
                    ? stored.requireContinuousActivity : DEFAULT_CONFIG.requireContinuousActivity,
            logPartialSessions:
                typeof stored.logPartialSessions === 'boolean'
                    ? stored.logPartialSessions : DEFAULT_CONFIG.logPartialSessions,
            activityUpdateIntervalSeconds: numericOr(
                stored.activityUpdateIntervalSeconds,
                DEFAULT_CONFIG.activityUpdateIntervalSeconds,
                NUMERIC_BOUNDS.activityUpdateIntervalSeconds.min,
                NUMERIC_BOUNDS.activityUpdateIntervalSeconds.max
            )
        };
        logger.debug('Loaded session config', config);
        return config;
    } catch (error) {
        logger.error('Error loading session config', error);
        return DEFAULT_CONFIG;
    }
}

/**
 * Coerce a stored value to a number within bounds, or fall back
 */
function numericOr(value: unknown, fallback: number, min: number, max: number): number {
    const num = Number(value);
    return Number.isFinite(num) && num >= min && num <= max ? num : fallback;
}

/**
 * Save session configuration to storage
 */
export async function saveSessionConfig(config: RawSessionConfig): Promise<void> {
    try {
        // Ensure values are the correct type and within sane bounds
        const sanitizedConfig: RawSessionConfig = {
            idleThresholdMinutes: Number(config.idleThresholdMinutes),
            minSessionDurationSeconds: Number(config.minSessionDurationSeconds),
            requireContinuousActivity: Boolean(config.requireContinuousActivity),
            logPartialSessions: Boolean(config.logPartialSessions),
            activityUpdateIntervalSeconds: Number(config.activityUpdateIntervalSeconds)
        };

        const invalid: string[] = [];
        if (!isFiniteInBounds(sanitizedConfig.idleThresholdMinutes, NUMERIC_BOUNDS.idleThresholdMinutes.min, NUMERIC_BOUNDS.idleThresholdMinutes.max)) {
            invalid.push(`idleThresholdMinutes must be between ${NUMERIC_BOUNDS.idleThresholdMinutes.min} and ${NUMERIC_BOUNDS.idleThresholdMinutes.max} minutes`);
        }
        if (!isFiniteInBounds(sanitizedConfig.minSessionDurationSeconds, NUMERIC_BOUNDS.minSessionDurationSeconds.min, NUMERIC_BOUNDS.minSessionDurationSeconds.max)) {
            invalid.push(`minSessionDurationSeconds must be between ${NUMERIC_BOUNDS.minSessionDurationSeconds.min} and ${NUMERIC_BOUNDS.minSessionDurationSeconds.max} seconds`);
        }
        if (!isFiniteInBounds(sanitizedConfig.activityUpdateIntervalSeconds, NUMERIC_BOUNDS.activityUpdateIntervalSeconds.min, NUMERIC_BOUNDS.activityUpdateIntervalSeconds.max)) {
            invalid.push(`activityUpdateIntervalSeconds must be between ${NUMERIC_BOUNDS.activityUpdateIntervalSeconds.min} and ${NUMERIC_BOUNDS.activityUpdateIntervalSeconds.max} seconds`);
        }
        if (invalid.length > 0) {
            throw new Error(`Invalid session settings: ${invalid.join('; ')}`);
        }

        await chrome.storage.sync.set({ sessionConfig: sanitizedConfig });
        logger.debug('Saved session config', sanitizedConfig);
    } catch (error) {
        logger.error('Error saving session config', error);
        throw error;
    }
}

/**
 * Convert configuration to milliseconds for internal use
 */
export function getConfigurationInMs(config: RawSessionConfig): SessionConfig {
    return {
        idleThreshold: config.idleThresholdMinutes * 60 * 1000,
        minSessionDuration: config.minSessionDurationSeconds * 1000,
        activityUpdateInterval: config.activityUpdateIntervalSeconds * 1000,
        requireContinuousActivity: config.requireContinuousActivity,
        logPartialSessions: config.logPartialSessions
    };
}
