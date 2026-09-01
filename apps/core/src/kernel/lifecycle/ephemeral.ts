/**
 * Redis-backed ephemeral store. Holds ONLY reconstructible operational state
 * (ADR-0004). Nothing here is authoritative; losing Redis degrades latency and
 * forces re-derivation, never data loss. MK.43 uses it for the instance
 * heartbeat + session-liveness keys, and as the thing the "Redis restart does
 * not destroy authority" resilience test kills.
 */
import { Redis } from 'ioredis';

export interface EphemeralStore {
  ping(): Promise<boolean>;
  setLive(key: string, ttlSec: number): Promise<void>;
  isLive(key: string): Promise<boolean>;
  close(): Promise<void>;
  readonly connected: boolean;
}

export class RedisEphemeralStore implements EphemeralStore {
  private readonly redis: Redis;
  private up = false;

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
      enableOfflineQueue: false,
    });
    this.redis.on('ready', () => (this.up = true));
    this.redis.on('end', () => (this.up = false));
    this.redis.on('error', () => (this.up = false));
  }

  async connect(): Promise<void> {
    try {
      await this.redis.connect();
      this.up = true;
    } catch {
      this.up = false; // degraded, not fatal
    }
  }

  get connected(): boolean {
    return this.up;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async setLive(key: string, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(`jarvis:live:${key}`, Date.now().toString(), 'EX', ttlSec);
    } catch {
      /* ephemeral - ignore */
    }
  }

  async isLive(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(`jarvis:live:${key}`)) === 1;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

/** No-op store for unit tests / no-Redis runs. */
export class NullEphemeralStore implements EphemeralStore {
  readonly connected = false;
  async ping(): Promise<boolean> {
    return false;
  }
  async setLive(): Promise<void> {}
  async isLive(): Promise<boolean> {
    return false;
  }
  async close(): Promise<void> {}
}
