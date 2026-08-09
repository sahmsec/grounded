import { describe, expect, it } from 'vitest';
import { classifyStatus, extractRetryAfterMs, toProviderError } from '../../src/providers/errors.ts';
import { ProviderError } from '../../src/errors/index.ts';

describe('classifyStatus', () => {
  it('maps status codes to the behaviour the pool should take', () => {
    expect(classifyStatus(429)).toBe('rate_limit');
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(403)).toBe('auth');
    expect(classifyStatus(500)).toBe('server');
    expect(classifyStatus(503)).toBe('server');
    expect(classifyStatus(400)).toBe('client');
    expect(classifyStatus(404)).toBe('client');
  });
});

describe('extractRetryAfterMs', () => {
  it('reads a Retry-After header in seconds', () => {
    expect(extractRetryAfterMs({ headers: { 'retry-after': '30' } })).toBe(30_000);
  });

  it('reads the retryDelay field Gemini returns on quota errors', () => {
    expect(extractRetryAfterMs({ message: 'RESOURCE_EXHAUSTED "retryDelay": "38s"' })).toBe(38_000);
  });

  it('reads the phrasing OpenAI uses', () => {
    expect(extractRetryAfterMs({ message: 'Rate limit reached. Please try again in 1.5s' })).toBe(1_500);
    expect(extractRetryAfterMs({ message: 'Please try again in 200ms' })).toBe(200);
  });

  it('returns null when no hint is present, so the default cooldown applies', () => {
    expect(extractRetryAfterMs({ message: 'something went wrong' })).toBeNull();
    expect(extractRetryAfterMs(null)).toBeNull();
  });
});

describe('toProviderError', () => {
  it('passes an existing ProviderError through unchanged', () => {
    const original = new ProviderError('gemini', 'auth', 'bad key');
    expect(toProviderError('gemini', original)).toBe(original);
  });

  it('classifies from a numeric status property', () => {
    const error = toProviderError('gemini', Object.assign(new Error('too many requests'), { status: 429 }));
    expect(error.kind).toBe('rate_limit');
  });

  it('falls back to the status embedded in a message', () => {
    expect(toProviderError('gemini', new Error('got 503 from upstream')).kind).toBe('server');
  });

  it('recognises quota language when no status is available', () => {
    expect(toProviderError('gemini', new Error('Resource exhausted for this project')).kind).toBe(
      'rate_limit',
    );
  });

  it('recognises credential language when no status is available', () => {
    expect(toProviderError('gemini', new Error('API key not valid')).kind).toBe('auth');
  });

  it('recognises transport failures as network errors', () => {
    expect(toProviderError('gemini', new Error('fetch failed')).kind).toBe('network');
    expect(toProviderError('gemini', new Error('read ECONNRESET')).kind).toBe('network');
  });

  it('marks anything unrecognised as unknown rather than guessing', () => {
    expect(toProviderError('gemini', new Error('surprising')).kind).toBe('unknown');
  });

  it('rotates for everything except client errors', () => {
    expect(toProviderError('gemini', new Error('got 429')).shouldRotate).toBe(true);
    expect(toProviderError('gemini', new Error('got 400')).shouldRotate).toBe(false);
  });

  it('carries the retry hint through to the pool', () => {
    const error = toProviderError(
      'gemini',
      Object.assign(new Error('quota "retryDelay": "12s"'), { status: 429 }),
    );
    expect(error.retryAfterMs).toBe(12_000);
  });
});
