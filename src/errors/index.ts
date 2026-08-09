/**
 * Typed error hierarchy.
 *
 * Every error carries a stable machine-readable `code` and the HTTP status it
 * should surface as, so the transport layer never has to guess and log
 * consumers never have to string-match on messages.
 */

export type ProviderFailureKind =
  | 'rate_limit' // 429 — temporary, credential should cool down
  | 'auth' // 401/403 — permanent, credential is dead until a human acts
  | 'server' // 5xx — transient, worth retrying in place
  | 'client' // 4xx we caused — retrying will not help
  | 'network' // never reached the provider
  | 'unknown';

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 500,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.details };
  }
}

/** Invalid or impossible configuration. Always fatal at startup. */
export class ConfigError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('config_error', message, 500, details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super('database_error', message, 500, details, options);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('validation_error', message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('not_found', message, 404, details);
  }
}

/**
 * A single upstream provider call failed. `kind` is what the pool uses to
 * decide between cooling the credential, killing it, or retrying in place.
 */
export class ProviderError extends AppError {
  readonly kind: ProviderFailureKind;
  readonly provider: string;
  /** Milliseconds to wait before this credential is usable again, if known. */
  readonly retryAfterMs: number | null;

  constructor(
    provider: string,
    kind: ProviderFailureKind,
    message: string,
    options: { retryAfterMs?: number | null; cause?: unknown; status?: number } = {},
  ) {
    super('provider_error', message, options.status ?? 502, { provider, kind }, { cause: options.cause });
    this.provider = provider;
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }

  /** True when trying a *different* credential could plausibly succeed. */
  get shouldRotate(): boolean {
    return this.kind !== 'client';
  }
}

/**
 * Every credential in the pool is cooling, dead, or over budget.
 *
 * This is deliberately distinct from ProviderError: it means the service
 * cannot answer at all right now, which is an operational alarm rather than
 * a single failed call.
 */
export class AllProvidersExhaustedError extends AppError {
  constructor(poolName: string, attempts: Array<{ credentialId: string; reason: string }>) {
    super(
      'all_providers_exhausted',
      `Every credential in the ${poolName} pool is unavailable`,
      503,
      { pool: poolName, attempts },
    );
  }
}

/** Narrowing helper for `catch` blocks, which are typed `unknown`. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new AppError('internal_error', message, 500, {}, { cause: value });
}
