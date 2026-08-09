/**
 * The relevance gate.
 *
 * Pure by design. This function is the entire refusal guarantee, so it takes
 * candidates and thresholds and returns a decision — no database, no model, no
 * clock. Everything about the product's most important behaviour can be tested
 * by calling it directly.
 */

import type { GateDecision, RetrievedChunk } from '../domain/types.ts';

export interface GateThresholds {
  /** The best candidate must reach this, or the question is refused outright. */
  minTopSimilarity: number;
  /** Individual chunks below this are dropped from the context. */
  minChunkSimilarity: number;
  /** Hard cap on chunks handed to the model. */
  maxContextChunks: number;
}

export function evaluateGate(candidates: RetrievedChunk[], thresholds: GateThresholds): GateDecision {
  if (candidates.length === 0) {
    return {
      admitted: false,
      chunks: [],
      topSimilarity: null,
      reason: 'no_matches',
      explanation: 'The knowledge base returned no candidates for this question.',
    };
  }

  const ranked = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const topSimilarity = ranked[0]!.similarity;

  if (topSimilarity < thresholds.minTopSimilarity) {
    return {
      admitted: false,
      chunks: [],
      topSimilarity,
      reason: 'below_top_threshold',
      explanation:
        `Best match scored ${topSimilarity.toFixed(4)}, below the ${thresholds.minTopSimilarity} gate. ` +
        'No model call was made.',
    };
  }

  const surviving = ranked
    .filter((chunk) => chunk.similarity >= thresholds.minChunkSimilarity)
    .slice(0, thresholds.maxContextChunks);

  if (surviving.length === 0) {
    // Unreachable while minChunkSimilarity <= minTopSimilarity, which config
    // validation enforces. Kept because a future threshold change should fail
    // as a refusal rather than as an empty prompt sent to the model.
    return {
      admitted: false,
      chunks: [],
      topSimilarity,
      reason: 'no_chunks_above_floor',
      explanation: `No chunk reached the ${thresholds.minChunkSimilarity} content floor.`,
    };
  }

  return {
    admitted: true,
    chunks: surviving,
    topSimilarity,
    reason: 'admitted',
    explanation:
      `Top match ${topSimilarity.toFixed(4)} cleared the ${thresholds.minTopSimilarity} gate; ` +
      `${surviving.length} of ${candidates.length} candidates retained.`,
  };
}
