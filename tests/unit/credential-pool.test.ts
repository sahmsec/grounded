import { describe, expect, it } from 'vitest';
import { CredentialPool, type PoolEvent } from '../../src/providers/pool/credential-pool.ts';
import type { CredentialConfig } from '../../src/config/index.ts';
import { AllProvidersExhaustedError, ProviderError } from '../../src/errors/index.ts';
import { silentLogger } from '../../src/logging/logger.ts';

function credentials(count: number, limits: CredentialConfig['limits'] = { rpm: null, rpd: null, tpm: null }) {
  return Array.from({ length: count }, (_, index) => ({
    id: `gemini#${index + 1}`,
    provider: 'gemini',
    apiKey: `key-${index + 1}`,
    priority: index,
    limits,
  }));
}

function clock(start = Date.UTC(2026, 7, 9, 12, 0, 0)) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function makePool(options: {
  credentials: CredentialConfig[];
  now?: () => number;
  events?: PoolEvent[];
  serverErrorRetries?: number;
}) {
  return new CredentialPool({
    name: 'llm',
    credentials: options.credentials,
    logger: silentLogger,
    now: options.now,
    defaultCooldownMs: 60_000,
    // Never actually wait in tests.
    sleep: async () => {},
    serverErrorRetries: options.serverErrorRetries,
    onEvent: (event) => options.events?.push(event),
  });
}

const rateLimited = (retryAfterMs?: number) =>
  new ProviderError('gemini', 'rate_limit', 'quota exceeded', { retryAfterMs });

describe('CredentialPool rotation', () => {
  it('uses the highest-priority credential when everything is healthy', async () => {
    const pool = makePool({ credentials: credentials(3) });

    const result = await pool.execute(async (credential) => ({ value: credential.id }));

    expect(result.value).toBe('gemini#1');
    expect(result.attempts).toBe(1);
  });

  it('rotates to the next credential on a 429 and succeeds there', async () => {
    const pool = makePool({ credentials: credentials(3) });

    const result = await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited();
      return { value: credential.id };
    });

    expect(result.value).toBe('gemini#2');
    expect(result.attempts).toBe(2);
  });

  it('keeps rotating through every credential until one answers', async () => {
    const pool = makePool({ credentials: credentials(4) });
    const tried: string[] = [];

    const result = await pool.execute(async (credential) => {
      tried.push(credential.id);
      if (credential.id !== 'gemini#4') throw rateLimited();
      return { value: 'ok' };
    });

    expect(tried).toEqual(['gemini#1', 'gemini#2', 'gemini#3', 'gemini#4']);
    expect(result.credentialId).toBe('gemini#4');
  });

  it('does not retry a cooling credential on the next call', async () => {
    const pool = makePool({ credentials: credentials(2) });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited();
      return { value: 'ok' };
    });

    const tried: string[] = [];
    await pool.execute(async (credential) => {
      tried.push(credential.id);
      return { value: 'ok' };
    });

    expect(tried).toEqual(['gemini#2']);
  });

  it('honours Retry-After and returns the credential when it elapses', async () => {
    const time = clock();
    const pool = makePool({ credentials: credentials(2), now: time.now });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited(30_000);
      return { value: 'ok' };
    });

    time.advance(29_000);
    let tried: string[] = [];
    await pool.execute(async (credential) => {
      tried.push(credential.id);
      return { value: 'ok' };
    });
    expect(tried).toEqual(['gemini#2']);

    time.advance(2_000);
    tried = [];
    await pool.execute(async (credential) => {
      tried.push(credential.id);
      return { value: 'ok' };
    });
    expect(tried).toEqual(['gemini#1']);
  });

  it('kills a credential permanently on 401 and never tries it again', async () => {
    const pool = makePool({ credentials: credentials(2) });
    const authFailure = new ProviderError('gemini', 'auth', 'invalid api key');

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw authFailure;
      return { value: 'ok' };
    });

    // A cooldown would eventually resurrect it; DEAD must not.
    for (let round = 0; round < 3; round += 1) {
      const tried: string[] = [];
      await pool.execute(async (credential) => {
        tried.push(credential.id);
        return { value: 'ok' };
      });
      expect(tried).toEqual(['gemini#2']);
    }

    expect(pool.status().credentials[0]!.state).toBe('dead');
  });

  it('retries a 5xx in place before giving up on the credential', async () => {
    const pool = makePool({ credentials: credentials(2), serverErrorRetries: 2 });
    let attempts = 0;

    const result = await pool.execute(async (credential) => {
      attempts += 1;
      if (credential.id === 'gemini#1' && attempts < 3) {
        throw new ProviderError('gemini', 'server', 'upstream 503');
      }
      return { value: credential.id };
    });

    expect(result.value).toBe('gemini#1');
    expect(attempts).toBe(3);
  });

  it('skips a credential whose local budget is spent without sending a request', async () => {
    const pool = makePool({ credentials: credentials(2, { rpm: 1, rpd: null, tpm: null }) });

    await pool.execute(async () => ({ value: 'first' }));

    const contacted: string[] = [];
    await pool.execute(async (credential) => {
      contacted.push(credential.id);
      return { value: 'second' };
    });

    // gemini#1 is over its RPM, so the callback never runs for it at all.
    expect(contacted).toEqual(['gemini#2']);
  });

  it('throws AllProvidersExhaustedError when nothing is usable', async () => {
    const pool = makePool({ credentials: credentials(2) });

    await expect(
      pool.execute(async () => {
        throw rateLimited();
      }),
    ).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });

  it('reports which credentials were skipped and why', async () => {
    const pool = makePool({ credentials: credentials(2) });

    try {
      await pool.execute(async () => {
        throw rateLimited();
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      const details = (error as AllProvidersExhaustedError).details as {
        attempts: Array<{ credentialId: string }>;
      };
      expect(details.attempts.map((entry) => entry.credentialId)).toEqual(['gemini#1', 'gemini#2']);
    }
  });

  it('does not rotate on a client error, because every key would fail the same way', async () => {
    const pool = makePool({ credentials: credentials(3) });
    const tried: string[] = [];

    await expect(
      pool.execute(async (credential) => {
        tried.push(credential.id);
        throw new ProviderError('gemini', 'client', 'malformed request');
      }),
    ).rejects.toThrow('malformed request');

    expect(tried).toEqual(['gemini#1']);
  });
});

describe('CredentialPool observability', () => {
  it('emits a warning when a credential starts cooling', async () => {
    const events: PoolEvent[] = [];
    const pool = makePool({ credentials: credentials(2), events });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited(15_000);
      return { value: 'ok' };
    });

    const cooling = events.find((event) => event.type === 'key.cooling');
    expect(cooling).toMatchObject({ level: 'warn', credentialId: 'gemini#1', pool: 'llm' });
    expect(cooling?.resetAt).toBeGreaterThan(0);
  });

  it('emits an error-level event when a credential dies', async () => {
    const events: PoolEvent[] = [];
    const pool = makePool({ credentials: credentials(2), events });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw new ProviderError('gemini', 'auth', 'bad key');
      return { value: 'ok' };
    });

    expect(events.find((event) => event.type === 'key.dead')).toMatchObject({
      level: 'error',
      credentialId: 'gemini#1',
    });
  });

  it('emits quota.approaching once the daily warning ratio is crossed', async () => {
    const events: PoolEvent[] = [];
    const pool = makePool({ credentials: credentials(1, { rpm: null, rpd: 10, tpm: null }), events });

    for (let index = 0; index < 8; index += 1) {
      await pool.execute(async () => ({ value: 'ok' }));
    }

    const warnings = events.filter((event) => event.type === 'quota.approaching');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.detail).toContain('8/10');
  });

  it('emits pool.exhausted when the last credential goes down', async () => {
    const events: PoolEvent[] = [];
    const pool = makePool({ credentials: credentials(1), events });

    await expect(
      pool.execute(async () => {
        throw rateLimited();
      }),
    ).rejects.toBeInstanceOf(AllProvidersExhaustedError);

    expect(events.find((event) => event.type === 'pool.exhausted')).toMatchObject({ level: 'error' });
  });

  it('derives pool state from how many credentials remain healthy', async () => {
    const pool = makePool({ credentials: credentials(3) });
    expect(pool.status().state).toBe('ok');

    await pool.execute(async (credential) => {
      if (credential.id !== 'gemini#3') throw rateLimited();
      return { value: 'ok' };
    });

    const status = pool.status();
    expect(status.healthy).toBe(1);
    expect(status.state).toBe('degraded');
  });

  it('reports an elapsed cooldown as healthy without needing a call first', async () => {
    const time = clock();
    const pool = makePool({ credentials: credentials(2), now: time.now });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited(10_000);
      return { value: 'ok' };
    });

    expect(pool.status().credentials[0]!.state).toBe('cooling');

    time.advance(11_000);
    expect(pool.status().credentials[0]!.state).toBe('healthy');
    expect(pool.status().credentials[0]!.cooldownUntil).toBeNull();
  });

  it('counts requests and failures per credential', async () => {
    const pool = makePool({ credentials: credentials(2) });

    await pool.execute(async (credential) => {
      if (credential.id === 'gemini#1') throw rateLimited();
      return { value: 'ok' };
    });

    const [first, second] = pool.status().credentials;
    expect(first!.totalFailures).toBe(1);
    expect(first!.totalRequests).toBe(0);
    expect(second!.totalRequests).toBe(1);
  });
});
