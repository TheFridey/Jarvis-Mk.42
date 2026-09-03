export interface SentinelThresholds { version: number; windowMs: number; bruteforceN: number; denialN: number; rateN: number; certDays: number; backupMaxAgeMs: number; }
export const DEFAULT_SENTINEL_THRESHOLDS: SentinelThresholds = { version: 1, windowMs: 60_000, bruteforceN: 5, denialN: 5, rateN: 30, certDays: 14, backupMaxAgeMs: 86_400_000 };
