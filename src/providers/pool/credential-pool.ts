/**
 * Credential pool with automatic rotation.
 *
 * A pool exposes the same surface as a single credential, so callers never
 * learn how many keys exist or which one served them. Credentials are tried in
 * priority order — every key of the first provider before the second provider
 * is touched — until one succeeds or all are unavailable.
 *
 * State transitions:
 *   HEALTHY -> COOLING  on 429, or when local counters say the budget is spent
 *   COOLING -> HEALTHY  when the cooldown elapses
 *   HEALTHY -> DEAD     on 401/403, terminal until a human intervenes
 *   HEALTHY -> HEALTHY  on 5xx, after retrying in place
 */

import type { CredentialConfig } from '../../config/index.ts';
import { AllProvidersExhaustedError, ProviderError, toAppError } from '../../errors/index.ts';
import type { Logger } from '../../logging/logger.ts';
import { QuotaTracker, type QuotaSnapshot, type UsageStore } from './quota.ts';

export type CredentialState = 'healthy' | 'cooling' | 'dead';

export type PoolEventType =
  | 'quota.approaching'
  | 'key.cooling'
  | 'key.recovered'
  | 'key.dead'
  | 'pool.exhausted';

export interface PoolEvent {
  type: PoolEventType;
  level: 'warn' | 'error';
  pool: string;
  credentialId?: string;
  provider?: string;
  detail: string;
  resetAt?: number;
}

export interface CredentialStatus {
  credentialId: string;
  provider: string;
  state: CredentialState;
  /** Epoch millis when a cooling credential returns to rotation. */
  cooldownUntil: number | null;
  lastError: string | null;
  totalRequests: number;
  totalFailures: number;
  quota: QuotaSnapshot;
}

export interface PoolStatus {
  name: string;
  /** Derived from how many credentials remain usable — never stored. */
  state: 'ok' | 'degraded' | 'exhausted';
  healthy: number;
  total: number;
  credentials: CredentialStatus[];
}

export interface PoolCallOutcome<T> {
  value: T;
  /** Tokens consumed, counted toward the per-minute token budget. */
  tokens?: number;
}

export type PoolCall<T> = (credential: CredentialConfig) => Promise<PoolCallOutcome<T>>;

export interface PoolResult<T> {
  value: T;
  credentialId: string;
  provider: string;
  /** How many credentials were tried, including the one that succeeded. */
  attempts: number;
}

export interface CredentialPoolOptions {
  name: string;
  credentials: CredentialConfig[];
  logger: Logger;
  defaultCooldownMs?: number;
  warnRatio?: number;
  usageStore?: UsageStore;
  onEvent?: (event: PoolEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** In-place retries for transient 5xx before rotating away. */
  serverErrorRetries?: number;
}

interface CredentialRuntime {
  config: CredentialConfig;
  state: CredentialState;
  cooldownUntil: number | null;
  lastError: string | null;
  totalRequests: number;
  totalFailures: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class CredentialPool {
  readonly name: string;
  private readonly runtimes: CredentialRuntime[];
  private readonly quota: QuotaTracker;
  private readonly logger: Logger;
  private readonly defaultCooldownMs: number;
  private readonly onEvent: (event: PoolEvent) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly serverErrorRetries: number;

  constructor(options: CredentialPoolOptions) {
    if (options.credentials.length === 0) {
      throw new Error(`Cannot create an empty ${options.name} pool`);
    }

    this.name = options.name;
    this.logger = options.logger.child({ pool: options.name });
    this.defaultCooldownMs = options.defaultCooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
    this.serverErrorRetries = options.serverErrorRetries ?? 2;
    this.onEvent = options.onEvent ?? (() => {});

    this.runtimes = [...options.credentials]
      .sort((a, b) => a.priority - b.priority)
      .map((config) => ({
        config,
        state: 'healthy' as CredentialState,
        cooldownUntil: null,
        lastError: null,
        totalRequests: 0,
        totalFailures: 0,
      }));

    this.quota = new QuotaTracker(options.credentials, {
      store: options.usageStore,
      now: this.now,
      warnRatio: options.warnRatio,
    });
  }

  async hydrate(): Promise<void> {
    await this.quota.hydrate();
  }

  private emit(event: PoolEvent): void {
    const { level, type, ...fields } = event;
    this.logger[level](type, fields);
    this.onEvent(event);
  }

  private cool(runtime: CredentialRuntime, until: number, detail: string): void {
    runtime.state = 'cooling';
    runtime.cooldownUntil = until;
    runtime.lastError = detail;
    this.emit({
      type: 'key.cooling',
      level: 'warn',
      pool: this.name,
      credentialId: runtime.config.id,
      provider: runtime.config.provider,
      detail,
      resetAt: until,
    });
  }

  private kill(runtime: CredentialRuntime, detail: string): void {
    runtime.state = 'dead';
    runtime.cooldownUntil = null;
    runtime.lastError = detail;
    this.emit({
      type: 'key.dead',
      level: 'error',
      pool: this.name,
      credentialId: runtime.config.id,
      provider: runtime.config.provider,
      detail,
    });
  }

  /** Moves an expired cooling credential back into rotation. */
  private refresh(runtime: CredentialRuntime): void {
    if (runtime.state !== 'cooling') return;
    if (runtime.cooldownUntil !== null && this.now() < runtime.cooldownUntil) return;

    runtime.state = 'healthy';
    runtime.cooldownUntil = null;
    this.emit({
      type: 'key.recovered',
      level: 'warn',
      pool: this.name,
      credentialId: runtime.config.id,
      provider: runtime.config.provider,
      detail: 'Cooldown elapsed, returned to rotation',
    });
  }

  async execute<T>(call: PoolCall<T>): Promise<PoolResult<T>> {
    const skipped: Array<{ credentialId: string; reason: string }> = [];
    let attempts = 0;

    for (const runtime of this.runtimes) {
      this.refresh(runtime);

      if (runtime.state === 'dead') {
        skipped.push({ credentialId: runtime.config.id, reason: runtime.lastError ?? 'dead' });
        continue;
      }

      if (runtime.state === 'cooling') {
        skipped.push({
          credentialId: runtime.config.id,
          reason: `cooling until ${new Date(runtime.cooldownUntil ?? 0).toISOString()}`,
        });
        continue;
      }

      // Predictive skip: no request is sent, so an exhausted key costs nothing.
      const verdict = this.quota.check(runtime.config.id);
      if (!verdict.allowed) {
        const detail = `Local ${verdict.limit} budget reached (${verdict.detail ?? 'no detail'})`;
        this.cool(runtime, verdict.resetAt ?? this.now() + this.defaultCooldownMs, detail);
        skipped.push({ credentialId: runtime.config.id, reason: detail });
        continue;
      }

      attempts += 1;
      const outcome = await this.attempt(runtime, call);

      if (outcome.ok) {
        return {
          value: outcome.value,
          credentialId: runtime.config.id,
          provider: runtime.config.provider,
          attempts,
        };
      }

      skipped.push({ credentialId: runtime.config.id, reason: outcome.reason });
      if (outcome.fatal) throw outcome.error;
    }

    this.emit({
      type: 'pool.exhausted',
      level: 'error',
      pool: this.name,
      detail: `No usable credential among ${this.runtimes.length}`,
    });

    throw new AllProvidersExhaustedError(this.name, skipped);
  }

  /**
   * Runs one credential, retrying in place for transient server errors.
   * Returns rather than throws for rotatable failures so `execute` can move on.
   */
  private async attempt<T>(
    runtime: CredentialRuntime,
    call: PoolCall<T>,
  ): Promise<
    | { ok: true; value: T }
    | { ok: false; reason: string; fatal: false; error: Error }
    | { ok: false; reason: string; fatal: true; error: Error }
  > {
    for (let retry = 0; ; retry += 1) {
      try {
        const result = await call(runtime.config);
        runtime.totalRequests += 1;

        const { crossedWarnThreshold } = this.quota.record(runtime.config.id, result.tokens ?? 0);
        if (crossedWarnThreshold) {
          const snapshot = this.quota.snapshot(runtime.config.id);
          this.emit({
            type: 'quota.approaching',
            level: 'warn',
            pool: this.name,
            credentialId: runtime.config.id,
            provider: runtime.config.provider,
            detail: `${snapshot.requestsToday}/${snapshot.limits.rpd} daily requests used`,
          });
        }

        return { ok: true, value: result.value };
      } catch (raw) {
        runtime.totalFailures += 1;
        const error = raw instanceof ProviderError ? raw : toAppError(raw);

        if (!(error instanceof ProviderError)) {
          // An unexpected error is our bug, not the provider's. Rotating would
          // just repeat it against every key in turn.
          runtime.lastError = error.message;
          return { ok: false, reason: error.message, fatal: true, error };
        }

        switch (error.kind) {
          case 'auth': {
            this.kill(runtime, error.message);
            return { ok: false, reason: error.message, fatal: false, error };
          }

          case 'rate_limit': {
            const until = this.now() + (error.retryAfterMs ?? this.defaultCooldownMs);
            this.cool(runtime, until, error.message);
            return { ok: false, reason: error.message, fatal: false, error };
          }

          case 'server':
          case 'network': {
            if (retry < this.serverErrorRetries) {
              await this.sleep(2 ** retry * 250);
              continue;
            }
            const until = this.now() + this.defaultCooldownMs;
            this.cool(runtime, until, `${error.message} (after ${retry + 1} attempts)`);
            return { ok: false, reason: error.message, fatal: false, error };
          }

          case 'client': {
            runtime.lastError = error.message;
            return { ok: false, reason: error.message, fatal: true, error };
          }

          default: {
            const until = this.now() + this.defaultCooldownMs;
            this.cool(runtime, until, error.message);
            return { ok: false, reason: error.message, fatal: false, error };
          }
        }
      }
    }
  }

  status(): PoolStatus {
    const credentials = this.runtimes.map<CredentialStatus>((runtime) => {
      // Report post-expiry state without mutating, so /admin/providers is a
      // read-only view that still tells the truth about elapsed cooldowns.
      const expired =
        runtime.state === 'cooling' &&
        runtime.cooldownUntil !== null &&
        this.now() >= runtime.cooldownUntil;

      return {
        credentialId: runtime.config.id,
        provider: runtime.config.provider,
        state: expired ? 'healthy' : runtime.state,
        cooldownUntil: expired ? null : runtime.cooldownUntil,
        lastError: runtime.lastError,
        totalRequests: runtime.totalRequests,
        totalFailures: runtime.totalFailures,
        quota: this.quota.snapshot(runtime.config.id),
      };
    });

    const healthy = credentials.filter((entry) => entry.state === 'healthy').length;
    const state = healthy === 0 ? 'exhausted' : healthy === 1 && credentials.length > 1 ? 'degraded' : 'ok';

    return { name: this.name, state, healthy, total: credentials.length, credentials };
  }
}
