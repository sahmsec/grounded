/** Shared shapes. Kept free of I/O so every layer can import them safely. */

export interface DocumentInput {
  slug: string;
  title: string;
  source: string;
  category: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentRecord {
  id: string;
  slug: string;
  title: string;
  source: string;
  category: string;
  content: string;
  metadata: Record<string, unknown>;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  /** Position within the parent document, 0-based. */
  index: number;
  content: string;
  /** Rough token estimate — used for budgeting, not billing. */
  tokenCount: number;
}

export interface ChunkRow {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embeddingModel: string;
}

/** A chunk returned by similarity search, joined to its parent document. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentSlug: string;
  documentTitle: string;
  source: string;
  chunkIndex: number;
  content: string;
  /** Cosine similarity in [0, 1]. Higher is closer. */
  similarity: number;
}

export interface Citation {
  /** 1-based marker as it appears in the answer text, e.g. [1]. */
  marker: number;
  documentSlug: string;
  documentTitle: string;
  source: string;
  chunkIndex: number;
  similarity: number;
}

export const REFUSAL_REASONS = [
  'no_matches',
  'below_top_threshold',
  'no_chunks_above_floor',
  'model_reported_insufficient_context',
] as const;

export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export interface GateDecision {
  /** True when the question may proceed to the model. */
  admitted: boolean;
  /** Chunks that survived the floor, capped and ordered by similarity. */
  chunks: RetrievedChunk[];
  /** Best similarity across all candidates, or null when nothing matched. */
  topSimilarity: number | null;
  reason: RefusalReason | 'admitted';
  /** Human-readable explanation, safe to log and to surface to an operator. */
  explanation: string;
}

export interface AnswerResult {
  answered: boolean;
  text: string;
  citations: Citation[];
  topSimilarity: number | null;
  reason: RefusalReason | 'admitted';
  /** True when no model was contacted — the gate resolved it alone. */
  refusedWithoutModelCall: boolean;
  meta: {
    candidatesConsidered: number;
    chunksUsed: number;
    provider: string | null;
    credentialId: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}
