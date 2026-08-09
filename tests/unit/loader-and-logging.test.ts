import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/ingest/loader.ts';
import { createLogger } from '../../src/logging/logger.ts';
import { ValidationError } from '../../src/errors/index.ts';
import { embedText, tokenise } from '../../src/providers/embeddings/deterministic.ts';

describe('parseDocument', () => {
  const valid = `---
slug: sql-injection
title: SQL Injection
source: Handbook 3.1
category: application-security
tags: injection, owasp
---

Body text here.`;

  it('reads frontmatter fields and body', () => {
    const document = parseDocument(valid, 'sql-injection.md');

    expect(document).toMatchObject({
      slug: 'sql-injection',
      title: 'SQL Injection',
      source: 'Handbook 3.1',
      category: 'application-security',
      content: 'Body text here.',
    });
    expect(document.metadata).toEqual({ tags: ['injection', 'owasp'] });
  });

  it('falls back to the filename for a missing slug', () => {
    const raw = valid.replace('slug: sql-injection\n', '');
    expect(parseDocument(raw, 'fallback-name.md').slug).toBe('fallback-name');
  });

  it('defaults the category when absent', () => {
    const raw = valid.replace('category: application-security\n', '');
    expect(parseDocument(raw, 'x.md').category).toBe('general');
  });

  it('rejects a file with no frontmatter', () => {
    expect(() => parseDocument('Just text.', 'x.md')).toThrow(ValidationError);
  });

  it('rejects a file missing a required field', () => {
    const raw = valid.replace('title: SQL Injection\n', '');
    expect(() => parseDocument(raw, 'x.md')).toThrow(/required frontmatter field "title"/);
  });

  it('rejects frontmatter with an empty body', () => {
    expect(() => parseDocument(`---\ntitle: T\nsource: S\n---\n\n   `, 'x.md')).toThrow(/no body/);
  });

  it('handles Windows line endings', () => {
    expect(parseDocument(valid.replace(/\n/g, '\r\n'), 'x.md').title).toBe('SQL Injection');
  });
});

describe('logger', () => {
  function capture(level?: 'debug' | 'info' | 'warn' | 'error') {
    const lines: string[] = [];
    const logger = createLogger({
      level,
      sink: (line) => lines.push(line),
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });
    return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
  }

  it('writes one JSON object per event', () => {
    const { logger, parsed } = capture();
    logger.info('retrieval.complete', { topScore: 0.81 });

    expect(parsed()[0]).toEqual({
      ts: '2026-08-09T12:00:00.000Z',
      level: 'info',
      event: 'retrieval.complete',
      topScore: 0.81,
    });
  });

  it('suppresses events below the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    expect(lines).toHaveLength(1);
  });

  it('carries child bindings into every event', () => {
    const { logger, parsed } = capture();
    logger.child({ requestId: 'abc' }).child({ pool: 'llm' }).info('key.cooling');

    expect(parsed()[0]).toMatchObject({ requestId: 'abc', pool: 'llm', event: 'key.cooling' });
  });

  it('serialises errors instead of emitting an empty object', () => {
    const { logger, parsed } = capture();
    logger.error('request.failed', { err: new Error('boom') });

    expect(parsed()[0].err).toMatchObject({ name: 'Error', message: 'boom' });
  });

  it('survives circular references rather than throwing mid-log', () => {
    const { logger, parsed } = capture();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(() => logger.info('event', { circular })).not.toThrow();
    expect(parsed()[0].circular.self).toBe('[circular]');
  });
});

describe('deterministic embeddings', () => {
  it('produces unit-length vectors of the requested size', () => {
    const vector = embedText('SQL injection alters a database query', 64);
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    expect(vector).toHaveLength(64);
    expect(magnitude).toBeCloseTo(1, 6);
  });

  it('is deterministic across calls', () => {
    expect(embedText('firewall policy', 32)).toEqual(embedText('firewall policy', 32));
  });

  it('scores overlapping text above unrelated text', () => {
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);

    const document = embedText('SQL injection lets an attacker tamper with database queries', 256);
    const related = embedText('attacker tampering with database queries', 256);
    const unrelated = embedText('a good recipe for pasta carbonara', 256);

    expect(dot(document, related)).toBeGreaterThan(0.4);
    expect(dot(document, unrelated)).toBeLessThan(0.1);
  });

  it('strips stopwords and normalises simple plurals', () => {
    expect(tokenise('The attackers are using firewalls')).toEqual(['attacker', 'using', 'firewall']);
  });

  it('stems long -ing and -ed forms but leaves short words that would be mangled', () => {
    // "tampering" -> "tamper" is useful; "using" -> "us" would not be, which
    // is why the suffix rules carry a minimum length.
    expect(tokenise('tampering tampered')).toEqual(['tamper', 'tamper']);
    expect(tokenise('using')).toEqual(['using']);
  });

  it('returns a zero vector for text with no content words', () => {
    expect(embedText('the and of', 16).every((value) => value === 0)).toBe(true);
  });
});
