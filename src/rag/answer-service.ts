/**
 * Grounded answering.
 *
 * The order of operations here is the product: understand the turn, retrieve,
 * judge, and only then — if the judgement allows — generate. A refusal
 * produced by the gate never reaches a model, which is what makes it free,
 * instant and impossible to talk around.
 */

import type { Config } from '../config/index.ts';
import type { ChunkRepository, DocumentRepository } from '../db/repositories.ts';
import type { AnswerResult, ConversationTurn, GateDecision, RetrievedChunk } from '../domain/types.ts';
import { ValidationError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import type { ProviderAccess } from '../admin/runtime.ts';
import { evaluateGate } from '../retrieval/gate.ts';
import { classifyIntent, isBengaliScript, smallTalkReply } from './intent.ts';
import { buildCitations, buildUserPrompt, referencedMarkers, SYSTEM_PROMPT } from './prompt.ts';
import { CANONICAL_REFUSAL, CANONICAL_REFUSAL_BN, isInsufficientContext } from './protocol.ts';
import { condenseQuestion, looksContextDependent } from './rewrite.ts';
import { detectStyle, isRefinementOnly, lastSubstantiveQuestion, styleDirective } from './refine.ts';

const MAX_QUESTION_LENGTH = 2000;
/** Enough to resolve a reference; more just costs tokens and adds noise. */
const MAX_HISTORY_TURNS = 6;
/** Topic list for small talk is stable, so it is fetched once per process. */
const TOPIC_CACHE_MS = 5 * 60_000;

export interface AnswerServiceDeps {
  config: Config;
  chunks: ChunkRepository;
  documents: DocumentRepository;
  /**
   * Read through an accessor rather than captured directly, so an admin
   * swapping provider or model takes effect on the next question instead of
   * the next restart.
   */
  providers: ProviderAccess;
  logger: Logger;
  now?: () => number;
}

export interface AskOptions {
  /** Prior turns, oldest first. Used only to resolve follow-up references. */
  history?: ConversationTurn[];
}

export interface AnswerService {
  ask(question: string, options?: AskOptions): Promise<AnswerResult>;
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
  const { config, chunks, documents, providers, logger } = deps;
  const now = deps.now ?? Date.now;

  let topics: string[] = [];
  let topicsFetchedAt = 0;

  async function topicNames(): Promise<string[]> {
    if (now() - topicsFetchedAt < TOPIC_CACHE_MS && topics.length > 0) return topics;
    try {
      topics = (await documents.listTopics()).map((topic) => topic.title);
      topicsFetchedAt = now();
    } catch {
      // Small talk is nicer with the topic list but must not depend on it.
    }
    return topics;
  }

  async function retrieve(question: string): Promise<{ candidates: RetrievedChunk[]; decision: GateDecision }> {
    const embedding = await providers.embeddings.embedQuery(question);
    const candidates = await chunks.search(embedding, config.gate.candidateLimit);
    return { candidates, decision: evaluateGate(candidates, config.gate) };
  }

  return {
    async ask(rawQuestion: string, options: AskOptions = {}): Promise<AnswerResult> {
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

      const history = (options.history ?? []).slice(-MAX_HISTORY_TURNS);

      // --- conversational turns resolve without retrieval or a model call ---
      // A refusal in the wrong language reads as a malfunction, so the fixed
      // strings follow the reader rather than the corpus.
      const bangla = isBengaliScript(question);
      const refusal = bangla ? CANONICAL_REFUSAL_BN : CANONICAL_REFUSAL;

      const intent = classifyIntent(question);
      const chat = smallTalkReply(intent, await topicNames(), bangla);
      if (chat !== null) {
        logger.info('answer.small_talk', { intent });
        return {
          answered: true,
          text: chat,
          citations: [],
          topSimilarity: null,
          reason: 'small_talk',
          intent,
          rewrittenQuestion: null,
          refusedWithoutModelCall: true,
          meta: emptyMeta(0, now() - startedAt),
        };
      }

      // --- a request about the answer's shape, not its subject --------------
      // "explain more" and "why so short" score well against the corpus but
      // are not answerable from it, so the model refuses a question it was
      // never really asked. Re-answer the earlier question in the shape the
      // reader wants instead.
      const style = detectStyle(question);
      const directive = style ? styleDirective(style) : undefined;

      let searchQuestion = question;
      let rewritten: string | null = null;

      if (isRefinementOnly(question)) {
        const previous = lastSubstantiveQuestion(history);
        if (previous !== null) {
          rewritten = previous;
          searchQuestion = previous;
          logger.info('question.refinement', { instruction: question, reanswering: previous, style });
        }
      }

      if (rewritten === null && history.length > 0 && looksContextDependent(question)) {
        const condensed = await condenseQuestion(question, history, providers.llm, config.llm.rewriteModel);
        if (condensed !== question) {
          rewritten = condensed;
          searchQuestion = condensed;
          logger.info('question.rewritten', { from: question, to: condensed });
        }
      }

      let { candidates, decision } = await retrieve(searchQuestion);

      // A follow-up the heuristic missed still gets one chance: if nothing
      // cleared the gate and there is a conversation to draw on, resolve the
      // reference and try again before refusing.
      if (!decision.admitted && rewritten === null && history.length > 0) {
        const condensed = await condenseQuestion(question, history, providers.llm, config.llm.rewriteModel);
        if (condensed !== question) {
          rewritten = condensed;
          searchQuestion = condensed;
          logger.info('question.rewritten_after_miss', { from: question, to: condensed });
          ({ candidates, decision } = await retrieve(condensed));
        }
      }

      logger.info('retrieval.complete', {
        question: searchQuestion,
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
          modelCalled: rewritten !== null,
        });

        return {
          answered: false,
          text: refusal,
          citations: [],
          topSimilarity: decision.topSimilarity,
          reason: decision.reason,
          intent,
          rewrittenQuestion: rewritten,
          // A rewrite costs a model call even when the answer is a refusal.
          refusedWithoutModelCall: rewritten === null,
          meta: emptyMeta(candidates.length, now() - startedAt),
        };
      }

      // The reader's own words are the question; the rewritten form is only how
      // it was searched. Answering the rewrite would reply in English to a
      // question asked in another language.
      const userPrompt = buildUserPrompt(question, decision.chunks, {
        styleDirective: directive,
        history,
        searchedAs: searchQuestion,
      });
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
          text: refusal,
          citations: [],
          topSimilarity: decision.topSimilarity,
          reason: 'model_reported_insufficient_context',
          intent,
          rewrittenQuestion: rewritten,
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
        intent,
        rewrittenQuestion: rewritten,
        refusedWithoutModelCall: false,
        meta,
      };
    },
  };
}
