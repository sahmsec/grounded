/** Turns documents into indexed, embedded chunks. */

import type { Config } from '../config/index.ts';
import type { ChunkRepository, DocumentRepository, EmbeddedChunk } from '../db/repositories.ts';
import type { DocumentInput } from '../domain/types.ts';
import { ValidationError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import type { ProviderAccess } from '../admin/runtime.ts';
import { chunkText } from './chunker.ts';

export interface IngestResult {
  slug: string;
  status: 'indexed' | 'unchanged';
  chunks: number;
}

export interface IngestionService {
  ingest(input: DocumentInput): Promise<IngestResult>;
  ingestAll(inputs: DocumentInput[]): Promise<IngestResult[]>;
}

export interface IngestionDeps {
  config: Config;
  documents: DocumentRepository;
  chunks: ChunkRepository;
  providers: ProviderAccess;
  logger: Logger;
}

export function createIngestionService(deps: IngestionDeps): IngestionService {
  const { config, documents, chunks, providers, logger } = deps;

  async function ingest(input: DocumentInput): Promise<IngestResult> {
    if (input.content.trim().length === 0) {
      throw new ValidationError(`Document "${input.slug}" has no content`, { slug: input.slug });
    }

    const { id, changed } = await documents.upsert(input);
    if (!changed) {
      logger.debug('ingest.unchanged', { slug: input.slug });
      return { slug: input.slug, status: 'unchanged', chunks: 0 };
    }

    const pieces = chunkText(input.content, config.chunking);
    if (pieces.length === 0) {
      throw new ValidationError(`Document "${input.slug}" produced no chunks`, { slug: input.slug });
    }

    // Prefixing the title gives short chunks enough context to be retrievable
    // on their own — a chunk that only says "Use parameterised queries" is
    // otherwise almost impossible to match to a question about SQL injection.
    const texts = pieces.map((piece) => `${input.title}\n\n${piece.content}`);
    const vectors = await providers.embeddings.embedDocuments(texts);

    const embedded: EmbeddedChunk[] = pieces.map((piece, index) => ({
      ...piece,
      embedding: vectors[index]!,
    }));

    const written = await chunks.replaceForDocument(id, embedded, providers.embeddings.model);
    logger.info('ingest.indexed', { slug: input.slug, chunks: written });

    return { slug: input.slug, status: 'indexed', chunks: written };
  }

  return {
    ingest,
    async ingestAll(inputs) {
      const results: IngestResult[] = [];
      // Sequential on purpose: parallel ingestion would multiply concurrent
      // embedding calls and burn free-tier rate limits for no real gain.
      for (const input of inputs) {
        results.push(await ingest(input));
      }
      return results;
    },
  };
}
