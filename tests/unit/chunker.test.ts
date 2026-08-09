import { describe, expect, it } from 'vitest';
import { chunkText, estimateTokens } from '../../src/ingest/chunker.ts';

const OPTIONS = { size: 300, overlap: 60 };

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('', OPTIONS)).toEqual([]);
    expect(chunkText('   \n\n  \t ', OPTIONS)).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = chunkText('SQL injection lets an attacker alter a query.', OPTIONS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('SQL injection lets an attacker alter a query.');
    expect(chunks[0]!.index).toBe(0);
  });

  it('splits long text into sequentially indexed chunks', () => {
    const paragraph = 'Attackers tamper with database queries. '.repeat(8).trim();
    const text = [paragraph, paragraph, paragraph].join('\n\n');

    const chunks = chunkText(text, OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, position) => expect(chunk.index).toBe(position));
  });

  it('never emits an empty chunk', () => {
    const text = 'One.\n\n\n\nTwo.\n\n   \n\nThree.\n\n' + 'padding text here. '.repeat(40);
    for (const chunk of chunkText(text, OPTIONS)) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('carries overlapping context between consecutive chunks', () => {
    const sentences = Array.from({ length: 30 }, (_, index) => `Sentence number ${index} about firewalls.`);
    const chunks = chunkText(sentences.join(' '), OPTIONS);

    expect(chunks.length).toBeGreaterThan(1);

    // The head of chunk N should appear somewhere in chunk N-1.
    for (let index = 1; index < chunks.length; index += 1) {
      const head = chunks[index]!.content.slice(0, 20);
      expect(chunks[index - 1]!.content).toContain(head);
    }
  });

  it('bounds chunk length even when overlap is added', () => {
    const text = 'Zero trust never assumes the network is safe. '.repeat(30);
    const chunks = chunkText(text, OPTIONS);

    for (const chunk of chunks) {
      // Overlap is capped at half the size, so this is the true upper bound.
      expect(chunk.content.length).toBeLessThanOrEqual(OPTIONS.size * 1.5);
    }
  });

  it('splits a single oversized sentence at a word boundary', () => {
    const text = `${'word '.repeat(200).trim()}.`;
    const chunks = chunkText(text, { size: 120, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).not.toMatch(/^\s|\s$/);
      expect(chunk.content.length).toBeLessThanOrEqual(120);
    }
  });

  it('is deterministic', () => {
    const text = 'Phishing impersonates a trusted sender. '.repeat(25);
    expect(chunkText(text, OPTIONS)).toEqual(chunkText(text, OPTIONS));
  });

  it('normalises line endings so the same document chunks identically on any platform', () => {
    const unix = 'First paragraph.\n\nSecond paragraph.';
    const windows = 'First paragraph.\r\n\r\nSecond paragraph.';
    expect(chunkText(windows, OPTIONS)).toEqual(chunkText(unix, OPTIONS));
  });

  it('rejects configurations that could never advance', () => {
    expect(() => chunkText('text', { size: 100, overlap: 100 })).toThrow(RangeError);
    expect(() => chunkText('text', { size: 0, overlap: 0 })).toThrow(RangeError);
    expect(() => chunkText('text', { size: 100, overlap: -1 })).toThrow(RangeError);
  });
});

describe('estimateTokens', () => {
  it('scales with length and never returns zero for real text', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
