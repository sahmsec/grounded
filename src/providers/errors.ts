/**
 * Translates whatever an SDK throws into a `ProviderError` the pool can act on.
 *
 * The pool's whole behaviour hinges on `kind`: a misread 429 wastes the rest of
 * the pool, and a misread 401 gets retried forever against a key that will
 * never work. So classification is deliberately conservative and explicit.
 */

import { ProviderError, type ProviderFailureKind } from '../errors/index.ts';

export function classifyStatus(status: number): ProviderFailureKind {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  if (status >= 400) return 'client';
  return 'unknown';
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Digs an HTTP status out of the various shapes SDKs use. */
function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;

  const direct = readNumber(record.status) ?? readNumber(record.statusCode) ?? readNumber(record.code);
  if (direct !== null && direct >= 100 && direct < 600) return direct;

  const response = record.response;
  if (typeof response === 'object' && response !== null) {
    const nested = readNumber((response as Record<string, unknown>).status);
    if (nested !== null) return nested;
  }

  // Last resort: Gemini and OpenAI both put the status in the message text.
  const message = typeof record.message === 'string' ? record.message : '';
  const match = /\b(4\d{2}|5\d{2})\b/.exec(message);
  if (match) return Number(match[1]);

  return null;
}

/**
 * Providers signal their preferred wait in several formats. Honouring it keeps
 * a credential out of rotation for exactly as long as it needs to be, rather
 * than a guessed default.
 */
export function extractRetryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;

  const headers = record.headers;
  if (typeof headers === 'object' && headers !== null) {
    const raw = (headers as Record<string, unknown>)['retry-after'];
    const seconds = readNumber(raw);
    if (seconds !== null) return seconds * 1000;
  }

  const text = [record.message, JSON.stringify(record.details ?? '')].filter(Boolean).join(' ');

  // Gemini: "retryDelay": "38s"
  const retryDelay = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/i.exec(text);
  if (retryDelay) return Math.round(Number(retryDelay[1]) * 1000);

  // OpenAI: "Please try again in 1.5s" / "in 20ms"
  const tryAgain = /try again in (\d+(?:\.\d+)?)(ms|s)\b/i.exec(text);
  if (tryAgain) {
    const value = Number(tryAgain[1]);
    return tryAgain[2] === 'ms' ? Math.round(value) : Math.round(value * 1000);
  }

  return null;
}

function looksLikeNetworkFailure(message: string): boolean {
  return /ECONNRESET|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed|network|socket hang up/i.test(
    message,
  );
}

export function toProviderError(provider: string, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const status = extractStatus(error);
  const retryAfterMs = extractRetryAfterMs(error);

  let kind: ProviderFailureKind;
  if (status !== null) {
    kind = classifyStatus(status);
  } else if (looksLikeNetworkFailure(message)) {
    kind = 'network';
  } else if (/quota|rate.?limit|resource.?exhausted/i.test(message)) {
    kind = 'rate_limit';
  } else if (/api.?key|unauthenticated|permission denied|unauthorized/i.test(message)) {
    kind = 'auth';
  } else {
    kind = 'unknown';
  }

  return new ProviderError(provider, kind, `${provider}: ${message}`, {
    retryAfterMs,
    cause: error,
    status: status ?? undefined,
  });
}
