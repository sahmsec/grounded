/**
 * Text chunking.
 *
 * Pure and deterministic: the same input always produces the same chunks, with
 * no clock, no I/O and no randomness. Chunk boundaries are chosen at the
 * largest structural unit that fits — paragraph, then sentence, then word —
 * because a chunk severed mid-sentence embeds as a fragment and retrieves
 * poorly.
 */

import type { Chunk } from '../domain/types.ts';

export interface ChunkOptions {
  /** Target maximum characters per chunk, including any overlap prefix. */
  size: number;
  /** Characters of trailing context repeated at the head of the next chunk. */
  overlap: number;
}

/** Roughly four characters per token. Used for budgeting, never for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(paragraph: string): string[] {
  // Break after terminal punctuation followed by whitespace. Keeps the
  // punctuation attached to the sentence it ends.
  const parts = paragraph.split(/(?<=[.!?])\s+/);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Last-resort split for a single run of text longer than one chunk. */
function hardSplit(text: string, size: number): string[] {
  const pieces: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(cursor + size, text.length);

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      // Only honour the word boundary if it does not shrink the piece to a stub.
      if (lastSpace > cursor + size * 0.6) end = lastSpace;
    }

    const piece = text.slice(cursor, end).trim();
    if (piece.length > 0) pieces.push(piece);
    cursor = end;
  }

  return pieces;
}

/**
 * Breaks the text into the largest units that individually fit within `size`.
 * Paragraphs stay whole where possible; oversized ones degrade to sentences,
 * and an oversized sentence degrades to a word-boundary split.
 */
function toUnits(text: string, size: number): string[] {
  const units: string[] = [];

  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length <= size) {
      units.push(trimmed);
      continue;
    }

    for (const sentence of splitSentences(trimmed)) {
      if (sentence.length <= size) {
        units.push(sentence);
      } else {
        units.push(...hardSplit(sentence, size));
      }
    }
  }

  return units;
}

/**
 * Takes the trailing `overlap` characters of a chunk, snapped forward to a
 * sentence boundary where one is available and a word boundary otherwise, so
 * the repeated context reads as language rather than a severed fragment.
 */
function tailFor(chunk: string, overlap: number): string {
  if (overlap <= 0 || chunk.length === 0) return '';

  const tail = chunk.slice(-overlap);
  const sentenceStart = tail.search(/(?<=[.!?])\s+/);
  if (sentenceStart !== -1) {
    const snapped = tail.slice(sentenceStart).trim();
    if (snapped.length > 0) return snapped;
  }

  const spaceIndex = tail.indexOf(' ');
  if (spaceIndex !== -1) {
    const snapped = tail.slice(spaceIndex + 1).trim();
    if (snapped.length > 0) return snapped;
  }

  return tail.trim();
}

export function chunkText(raw: string, options: ChunkOptions): Chunk[] {
  const { size } = options;
  if (size <= 0) throw new RangeError('chunk size must be positive');
  if (options.overlap < 0) throw new RangeError('chunk overlap cannot be negative');
  if (options.overlap >= size) throw new RangeError('chunk overlap must be smaller than chunk size');

  const text = normalise(raw);
  if (text.length === 0) return [];

  // Capping overlap at half the chunk guarantees every chunk still carries
  // meaningful new content rather than mostly repeating its predecessor.
  const overlap = Math.min(options.overlap, Math.floor(size / 2));

  const units = toUnits(text, size);
  const chunks: string[] = [];

  let buffer = '';
  let carry = '';

  const flush = (): void => {
    const body = buffer.trim();
    if (body.length === 0) return;
    const full = carry.length > 0 ? `${carry}\n\n${body}` : body;
    chunks.push(full);
    carry = tailFor(full, overlap);
    buffer = '';
  };

  for (const unit of units) {
    const prospective = buffer.length === 0 ? unit : `${buffer}\n\n${unit}`;
    const withCarry = carry.length > 0 ? carry.length + 2 + prospective.length : prospective.length;

    if (buffer.length > 0 && withCarry > size) {
      flush();
      buffer = unit;
    } else {
      buffer = prospective;
    }
  }

  flush();

  return chunks.map((content, index) => ({
    index,
    content,
    tokenCount: estimateTokens(content),
  }));
}
