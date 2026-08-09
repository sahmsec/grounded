/**
 * Local quota accounting.
 *
 * No provider exposes a "how much is left" endpoint, so the only way to avoid
 * spending a request to discover a credential is exhausted is to count locally.
 * This is the *predictive* half of the pool; the 429 handler in
 * `credential-pool.ts` is the corrective half. Neither is sufficient alone.
 */

import type { CredentialConfig, QuotaLimits } from '../../config/index.ts';

/** Persists the daily counter so a restart does not reset the day's spend. */
export interface UsageStore {
  load(credentialIds: string[], date: string): Promise<Map<string, { requests: number; tokens: number }>>;
  increment(credentialId: string, date: string, requests: number, tokens: number): Promise<void>;
}

/** Used in tests and offline runs. Daily counts simply do not survive a restart. */
export const memoryUsageStore: UsageStore = {
  async load() {
    return new Map();
  },
  async increment() {
    /* no-op */
  },
};

export interface QuotaVerdict {
  allowed: boolean;
  /** Which limit blocked it, when blocked. */
  limit?: 'rpm' | 'rpd' | 'tpm';
  /** Epoch millis at which this credential becomes usable again. */
  resetAt?: number;
  detail?: string;
}

export interface QuotaSnapshot {
  credentialId: string;
  provider: string;
  limits: QuotaLimits;
  requestsThisMinute: number;
  tokensThisMinute: number;
  requestsToday: number;
  tokensToday: number;
  /** Fraction of the daily request cap consumed, or null when uncapped. */
  dailyRatio: number | null;
}

interface CredentialCounters {
  config: CredentialConfig;
  /** Timestamps and token costs within the trailing minute. */
  minute: Array<{ at: number; tokens: number }>;
  day: string;
  dayRequests: number;
  dayTokens: number;
  /** True once a quota.approaching warning has fired for the current day. */
  warned: boolean;
}

const MINUTE_MS = 60_000;

export function dateKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Epoch millis of the next UTC midnight after `at`. */
export function nextDayResetAt(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export class QuotaTracker {
  private readonly counters = new Map<string, CredentialCounters>();
  private readonly store: UsageStore;
  private readonly now: () => number;
  private readonly warnRatio: number;

  constructor(
    credentials: CredentialConfig[],
    options: { store?: UsageStore; now?: () => number; warnRatio?: number } = {},
  ) {
    this.store = options.store ?? memoryUsageStore;
    this.now = options.now ?? Date.now;
    this.warnRatio = options.warnRatio ?? 0.8;

    for (const config of credentials) {
      this.counters.set(config.id, {
        config,
        minute: [],
        day: dateKey(this.now()),
        dayRequests: 0,
        dayTokens: 0,
        warned: false,
      });
    }
  }

  /** Rehydrates today's counters from the store. Safe to skip when offline. */
  async hydrate(): Promise<void> {
    const ids = [...this.counters.keys()];
    if (ids.length === 0) return;

    const today = dateKey(this.now());
    const persisted = await this.store.load(ids, today);

    for (const [id, usage] of persisted) {
      const counter = this.counters.get(id);
      if (!counter) continue;
      counter.day = today;
      counter.dayRequests = usage.requests;
      counter.dayTokens = usage.tokens;
    }
  }

  private counterFor(credentialId: string): CredentialCounters {
    const counter = this.counters.get(credentialId);
    if (!counter) throw new Error(`Unknown credential ${credentialId}`);

    const now = this.now();
    const today = dateKey(now);
    if (counter.day !== today) {
      counter.day = today;
      counter.dayRequests = 0;
      counter.dayTokens = 0;
      counter.warned = false;
    }

    const cutoff = now - MINUTE_MS;
    if (counter.minute.length > 0 && counter.minute[0]!.at <= cutoff) {
      counter.minute = counter.minute.filter((entry) => entry.at > cutoff);
    }

    return counter;
  }

  /** Whether this credential may be used right now, without contacting anyone. */
  check(credentialId: string): QuotaVerdict {
    const counter = this.counterFor(credentialId);
    const { limits } = counter.config;
    const now = this.now();

    if (limits.rpd !== null && counter.dayRequests >= limits.rpd) {
      return {
        allowed: false,
        limit: 'rpd',
        resetAt: nextDayResetAt(now),
        detail: `${counter.dayRequests}/${limits.rpd} requests today`,
      };
    }

    if (limits.rpm !== null && counter.minute.length >= limits.rpm) {
      const oldest = counter.minute[0]!.at;
      return {
        allowed: false,
        limit: 'rpm',
        resetAt: oldest + MINUTE_MS,
        detail: `${counter.minute.length}/${limits.rpm} requests this minute`,
      };
    }

    if (limits.tpm !== null) {
      const tokensThisMinute = counter.minute.reduce((sum, entry) => sum + entry.tokens, 0);
      if (tokensThisMinute >= limits.tpm) {
        const oldest = counter.minute[0]?.at ?? now;
        return {
          allowed: false,
          limit: 'tpm',
          resetAt: oldest + MINUTE_MS,
          detail: `${tokensThisMinute}/${limits.tpm} tokens this minute`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Records a completed call. Returns true the first time the credential
   * crosses the daily warning ratio, so the caller can emit exactly one
   * `quota.approaching` event per credential per day.
   */
  record(credentialId: string, tokens: number): { crossedWarnThreshold: boolean } {
    const counter = this.counterFor(credentialId);
    const now = this.now();

    counter.minute.push({ at: now, tokens });
    counter.dayRequests += 1;
    counter.dayTokens += tokens;

    void this.store
      .increment(credentialId, counter.day, 1, tokens)
      .catch(() => {
        // Persistence is an optimisation over in-memory counting. Losing a
        // write costs accuracy after a restart, never correctness now.
      });

    const { rpd } = counter.config.limits;
    if (rpd !== null && !counter.warned && counter.dayRequests >= rpd * this.warnRatio) {
      counter.warned = true;
      return { crossedWarnThreshold: true };
    }

    return { crossedWarnThreshold: false };
  }

  snapshot(credentialId: string): QuotaSnapshot {
    const counter = this.counterFor(credentialId);
    const { limits } = counter.config;

    return {
      credentialId,
      provider: counter.config.provider,
      limits,
      requestsThisMinute: counter.minute.length,
      tokensThisMinute: counter.minute.reduce((sum, entry) => sum + entry.tokens, 0),
      requestsToday: counter.dayRequests,
      tokensToday: counter.dayTokens,
      dailyRatio: limits.rpd === null ? null : counter.dayRequests / limits.rpd,
    };
  }
}
