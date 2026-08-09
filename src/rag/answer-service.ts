/**
 * Grounded answering.
 *
 * The order of operations here is the product: retrieve, judge, and only then
 * — if the judgement allows — generate. A refusal produced by the gate never
 * reaches a model, which is what makes it free, instant and impossible to
 * talk around.
 */

import type { Config } from '../config/index.ts';
import type { ChunkRepository } from '../db/repositories.ts';
import type { AnswerResult, RetrievedChunk } from '../domain/types.ts';
import { ValidationError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import type { ProviderAccess } from '../admin/runtime.ts';
import { evaluateGate } from '../retrieval/gate.ts';
import { buildCitations, buildUserPrompt, referencedMarkers, SYSTEM_PROMPT } from './prompt.ts';
import { CANONICAL_REFUSAL, isInsufficientContext } from './protocol.ts';

const MAX_QUESTION_LENGTH = 2000;

export interface AnswerServiceDeps {
  config: Config;
  chunks: ChunkRepository;
  /**
   * Read through an accessor rather than captured directly, so an admin
   * swapping provider or model takes effect on the next question instead of
   * the next restart.
   */
  providers: ProviderAccess;
  logger: Logger;
  now?: () => number;
}

export interface AnswerService {
  ask(question: string): Promise<AnswerResult>;
}

function emptyMeta(candidates: number, latencyMs: number): AnswerResult['meta'] {
  return {
    candidatesConsidered: candidates,
    chunksUsed: 0,
    provider: null,
    credentialId: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs,
  };
}

/** Compact retrieval trace. Without it, relevance problems are unfalsifiable. */
function traceOf(candidates: RetrievedChunk[]): Array<Record<string, unknown>> {
  return candidates.slice(0, 5).map((chunk) => ({
    slug: chunk.documentSlug,
    chunk: chunk.chunkIndex,
    score: Number(chunk.similarity.toFixed(4)),
  }));
}

export function createAnswerService(deps: AnswerServiceDeps): AnswerService {
  const { config, chunks, providers, logger } = deps;
  const now = deps.now ?? Date.now;

  return {
    async ask(rawQuestion: string): Promise<AnswerResult> {
      const startedAt = now();
      const question = rawQuestion.trim();

      if (question.length === 0) {
        throw new ValidationError('Question must not be empty');
      }
      if (question.length > MAX_QUESTION_LENGTH) {
        throw new ValidationError(`Question exceeds ${MAX_QUESTION_LENGTH} characters`, {
          length: question.length,
        });
      }

      const queryEmbedding = await providers.embeddings.embedQuery(question);
      const candidates = await chunks.search(queryEmbedding, config.gate.candidateLimit);
      const decision = evaluateGate(candidates, config.gate);

      logger.info('retrieval.complete', {
        question,
        candidates: candidates.length,
        topScore: decision.topSimilarity,
        admitted: decision.admitted,
        reason: decision.reason,
        trace: traceOf(candidates),
      });

      if (!decision.admitted) {
        logger.info('answer.refused', {
          reason: decision.reason,
          topScore: decision.topSimilarity,
          modelCalled: false,
        });

        return {
          answered: false,
          text: CANONICAL_REFUSAL,
          citations: [],
          topSimilarity: decision.topSimilarity,
          reason: decision.reason,
          refusedWithoutModelCall: true,
          meta: emptyMeta(candidates.length, now() - startedAt),
        };
      }

      const userPrompt = buildUserPrompt(question, decision.chunks);
      const completion = await providers.llm.generate({
        system: SYSTEM_PROMPT,
        user: userPrompt,
        maxTokens: config.llm.maxOutputTokens,
        temperature: config.llm.temperature,
      });

      const meta: AnswerResult['meta'] = {
        candidatesConsidered: candidates.length,
        chunksUsed: decision.chunks.length,
        provider: completion.provider,
        credentialId: completion.credentialId,
        model: completion.model,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        latencyMs: now() - startedAt,
      };

      // The model gets the final say on whether its own context was enough.
      // The gate is the floor, not the ceiling.
      if (isInsufficientContext(completion.text)) {
        logger.info('answer.refused', {
          reason: 'model_reported_insufficient_context',
          topScore: decision.topSimilarity,
          modelCalled: true,
        });

        return {
          answered: false,
          text: CANONICAL_REFUSAL,
          citations: [],
          topSimilarity: decision.topSimilarity,
          reason: 'model_reported_insufficient_context',
          refusedWithoutModelCall: false,
          meta,
        };
      }

      const allCitations = buildCitations(decision.chunks);
      const used = referencedMarkers(completion.text);
      const citations = used.size > 0 ? allCitations.filter((entry) => used.has(entry.marker)) : allCitations;

      logger.info('answer.generated', {
        topScore: decision.topSimilarity,
        chunksUsed: decision.chunks.length,
        citations: citations.length,
        provider: completion.provider,
        credentialId: completion.credentialId,
        latencyMs: meta.latencyMs,
      });

      return {
        answered: true,
        text: completion.text.trim(),
        citations,
        topSimilarity: decision.topSimilarity,
        reason: 'admitted',
        refusedWithoutModelCall: false,
        meta,
      };
    },
  };
}
