import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../src/retrieval/gate.ts';
import type { RetrievedChunk } from '../../src/domain/types.ts';

const THRESHOLDS = { minTopSimilarity: 0.62, minChunkSimilarity: 0.55, maxContextChunks: 3 };

function chunk(similarity: number, slug = 'sql-injection', index = 0): RetrievedChunk {
  return {
    chunkId: `${slug}-${index}`,
    documentId: slug,
    documentSlug: slug,
    documentTitle: slug,
    source: 'handbook',
    chunkIndex: index,
    content: `content ${index}`,
    similarity,
  };
}

describe('evaluateGate', () => {
  it('refuses when retrieval found nothing at all', () => {
    const decision = evaluateGate([], THRESHOLDS);

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe('no_matches');
    expect(decision.topSimilarity).toBeNull();
    expect(decision.chunks).toEqual([]);
  });

  it('refuses when the best candidate is below the gate', () => {
    const decision = evaluateGate([chunk(0.61), chunk(0.4)], THRESHOLDS);

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe('below_top_threshold');
    expect(decision.topSimilarity).toBeCloseTo(0.61);
    // Nothing is handed onward, so no model call is even possible.
    expect(decision.chunks).toEqual([]);
  });

  it('admits exactly at the threshold', () => {
    const decision = evaluateGate([chunk(0.62)], THRESHOLDS);

    expect(decision.admitted).toBe(true);
    expect(decision.reason).toBe('admitted');
    expect(decision.chunks).toHaveLength(1);
  });

  it('drops chunks below the content floor while admitting the question', () => {
    const decision = evaluateGate([chunk(0.9, 'a'), chunk(0.56, 'b'), chunk(0.2, 'c')], THRESHOLDS);

    expect(decision.admitted).toBe(true);
    expect(decision.chunks.map((entry) => entry.documentSlug)).toEqual(['a', 'b']);
  });

  it('caps the context at maxContextChunks', () => {
    const candidates = [0.95, 0.9, 0.85, 0.8, 0.75].map((score, index) => chunk(score, `doc-${index}`, index));
    const decision = evaluateGate(candidates, THRESHOLDS);

    expect(decision.chunks).toHaveLength(3);
    expect(decision.chunks.map((entry) => entry.documentSlug)).toEqual(['doc-0', 'doc-1', 'doc-2']);
  });

  it('orders context by similarity regardless of input order', () => {
    const decision = evaluateGate([chunk(0.7, 'low'), chunk(0.95, 'high'), chunk(0.8, 'mid')], THRESHOLDS);

    expect(decision.chunks.map((entry) => entry.documentSlug)).toEqual(['high', 'mid', 'low']);
    expect(decision.topSimilarity).toBeCloseTo(0.95);
  });

  it('does not mutate the caller’s array', () => {
    const candidates = [chunk(0.7, 'low'), chunk(0.95, 'high')];
    const snapshot = candidates.map((entry) => entry.documentSlug);

    evaluateGate(candidates, THRESHOLDS);

    expect(candidates.map((entry) => entry.documentSlug)).toEqual(snapshot);
  });

  it('refuses when every chunk falls under the floor despite a high top score', () => {
    // Only reachable with a floor above the gate, which config rejects — the
    // branch exists so a future threshold change fails as a refusal.
    const decision = evaluateGate([chunk(0.7)], {
      minTopSimilarity: 0.6,
      minChunkSimilarity: 0.8,
      maxContextChunks: 3,
    });

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe('no_chunks_above_floor');
  });

  it('explains its decision in terms an operator can act on', () => {
    const refused = evaluateGate([chunk(0.31)], THRESHOLDS);
    expect(refused.explanation).toContain('0.3100');
    expect(refused.explanation).toContain('0.62');
  });
});
