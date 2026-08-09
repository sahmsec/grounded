/**
 * Offline embedding provider — hashed bag-of-words, not a neural model.
 *
 * What it genuinely provides: deterministic, L2-normalised vectors whose
 * cosine similarity reflects *lexical* overlap. Passages sharing content words
 * score high, unrelated passages score near zero, and the whole retrieval →
 * gate → refusal path can therefore be tested with no key, no network and no
 * per-run variance.
 *
 * What it does not provide: real semantics. It cannot connect "tamper with
 * database queries" to "SQL injection" unless the words overlap. Live
 * paraphrase quality is a property of the real embedding model, so the seed
 * corpus is written with the vocabulary users actually reach for, and the
 * live smoke run is what proves semantic retrieval.
 */

import type { EmbeddingProvider } from './types.ts';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'from', 'into', 'about', 'that', 'this',
  'these', 'those', 'it', 'its', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'may', 'might', 'must', 'have', 'has', 'had', 'not', 'no', 'so', 'than', 'them', 'they', 'their',
  'you', 'your', 'we', 'our', 'us', 'i', 'my', 'me', 'he', 'she', 'his', 'her', 'what', 'which',
  'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'there', 'here',
]);

/** Crude but stable suffix stripping, so "attacks" and "attack" collide. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

/** FNV-1a. Chosen for being stable across runs and platforms, not for speed. */
function hash(word: string, seed: number): number {
  let value = 2166136261 ^ seed;
  for (let index = 0; index < word.length; index += 1) {
    value ^= word.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function embedText(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const counts = new Map<string, number>();

  for (const token of tokenise(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, count] of counts) {
    const bucket = hash(token, 0) % dimensions;
    // A second hash decides the sign, so unrelated tokens landing in the same
    // bucket tend to cancel rather than reinforce.
    const sign = hash(token, 0x9e3779b9) % 2 === 0 ? 1 : -1;
    // Sublinear scaling stops a single repeated word dominating the vector.
    vector[bucket] = (vector[bucket] ?? 0) + sign * (1 + Math.log(count));
  }

  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  if (sumSquares === 0) return vector;

  const magnitude = Math.sqrt(sumSquares);
  return vector.map((value) => value / magnitude);
}

export function createDeterministicEmbeddings(dimensions: number): EmbeddingProvider {
  return {
    name: 'deterministic',
    model: 'deterministic-v1',
    dimensions,
    async embedDocuments(texts) {
      return texts.map((text) => embedText(text, dimensions));
    },
    async embedQuery(text) {
      return embedText(text, dimensions);
    },
  };
}
