import { describe, expect, it } from 'vitest';
import { QuotaTracker, dateKey, nextDayResetAt } from '../../src/providers/pool/quota.ts';
import type { CredentialConfig } from '../../src/config/index.ts';

function credential(overrides: Partial<CredentialConfig> = {}): CredentialConfig {
  return {
    id: 'gemini#1',
    provider: 'gemini',
    apiKey: 'k',
    priority: 0,
    limits: { rpm: 3, rpd: 10, tpm: null },
    ...overrides,
  };
}

/** A controllable clock, so none of these tests depend on wall time. */
function clock(start = Date.UTC(2026, 7, 9, 12, 0, 0)) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('QuotaTracker', () => {
  it('allows calls until the per-minute limit is reached', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential()], { now: time.now });

    for (let index = 0; index < 3; index += 1) {
      expect(tracker.check('gemini#1').allowed).toBe(true);
      tracker.record('gemini#1', 100);
    }

    const verdict = tracker.check('gemini#1');
    expect(verdict.allowed).toBe(false);
    expect(verdict.limit).toBe('rpm');
  });

  it('frees the minute window as requests age out', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential()], { now: time.now });

    for (let index = 0; index < 3; index += 1) tracker.record('gemini#1', 0);
    expect(tracker.check('gemini#1').allowed).toBe(false);

    time.advance(60_001);
    expect(tracker.check('gemini#1').allowed).toBe(true);
  });

  it('reports the daily limit and the next UTC midnight as its reset', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: 2, tpm: null } })], {
      now: time.now,
    });

    tracker.record('gemini#1', 0);
    tracker.record('gemini#1', 0);

    const verdict = tracker.check('gemini#1');
    expect(verdict.allowed).toBe(false);
    expect(verdict.limit).toBe('rpd');
    expect(verdict.resetAt).toBe(nextDayResetAt(time.now()));
  });

  it('rolls the daily counter over at a date change', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: 1, tpm: null } })], {
      now: time.now,
    });

    tracker.record('gemini#1', 0);
    expect(tracker.check('gemini#1').allowed).toBe(false);

    time.advance(24 * 60 * 60 * 1000);
    expect(tracker.check('gemini#1').allowed).toBe(true);
  });

  it('enforces a token-per-minute budget separately from request count', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: null, tpm: 1000 } })], {
      now: time.now,
    });

    tracker.record('gemini#1', 600);
    expect(tracker.check('gemini#1').allowed).toBe(true);

    tracker.record('gemini#1', 500);
    const verdict = tracker.check('gemini#1');
    expect(verdict.allowed).toBe(false);
    expect(verdict.limit).toBe('tpm');
  });

  it('signals the warning threshold exactly once per day', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: 10, tpm: null } })], {
      now: time.now,
      warnRatio: 0.8,
    });

    const crossings: boolean[] = [];
    for (let index = 0; index < 10; index += 1) {
      crossings.push(tracker.record('gemini#1', 0).crossedWarnThreshold);
    }

    // Fires on the 8th request (80% of 10) and never again that day.
    expect(crossings.filter(Boolean)).toHaveLength(1);
    expect(crossings[7]).toBe(true);
  });

  it('treats unlimited axes as never blocking', () => {
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: null, tpm: null } })]);

    for (let index = 0; index < 500; index += 1) tracker.record('gemini#1', 10_000);
    expect(tracker.check('gemini#1').allowed).toBe(true);
  });

  it('rehydrates the daily counter from the store', async () => {
    const time = clock();
    const today = dateKey(time.now());
    const tracker = new QuotaTracker([credential({ limits: { rpm: null, rpd: 5, tpm: null } })], {
      now: time.now,
      store: {
        async load() {
          return new Map([['gemini#1', { requests: 5, tokens: 900 }]]);
        },
        async increment() {},
      },
    });

    await tracker.hydrate();

    // A restart must not hand the credential a fresh day's allowance.
    expect(tracker.check('gemini#1').allowed).toBe(false);
    expect(tracker.snapshot('gemini#1').requestsToday).toBe(5);
    expect(dateKey(time.now())).toBe(today);
  });

  it('exposes a snapshot suitable for an operator view', () => {
    const time = clock();
    const tracker = new QuotaTracker([credential()], { now: time.now });

    tracker.record('gemini#1', 250);
    const snapshot = tracker.snapshot('gemini#1');

    expect(snapshot).toMatchObject({
      credentialId: 'gemini#1',
      provider: 'gemini',
      requestsThisMinute: 1,
      tokensThisMinute: 250,
      requestsToday: 1,
      tokensToday: 250,
    });
    expect(snapshot.dailyRatio).toBeCloseTo(0.1);
  });
});
