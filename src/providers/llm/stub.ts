/**
 * Offline LLM.
 *
 * Extracts sentences from the supplied context that overlap the question,
 * cites them, and emits the insufficient-context sentinel when nothing
 * overlaps. It is not intelligent — it exists so the pipeline, the gate, the
 * refusal path and the citation format can all be exercised with no API key,
 * no network and no cost.
 */

import { INSUFFICIENT_CONTEXT_SENTINEL, QUESTION_MARKER, SOURCE_BLOCK_PATTERN } from '../../rag/protocol.ts';
import { estimateTokens } from '../../ingest/chunker.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'for', 'with', 'as', 'by', 'at', 'from', 'that', 'this', 'it', 'its', 'do', 'does', 'did',
  'how', 'what', 'why', 'when', 'which', 'who', 'can', 'you', 'i', 'we', 'they', 'my', 'our',
]);

function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map((word) => (word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word));
  return new Set(words);
}

export function createStubLlm(model = 'stub-v1'): LlmProvider {
  return {
    name: 'stub',
    model,

    async generate(request: LlmRequest): Promise<LlmResponse> {
      const questionMatch = request.user.indexOf(QUESTION_MARKER);
      const question =
        questionMatch === -1
          ? request.user
          : request.user.slice(questionMatch + QUESTION_MARKER.length).trim();

      const questionWords = contentWords(question);

      const sources: Array<{ marker: number; body: string }> = [];
      for (const match of request.user.matchAll(SOURCE_BLOCK_PATTERN)) {
        sources.push({ marker: Number(match[1]), body: (match[2] ?? '').trim() });
      }

      const scored = sources
        .map((source) => {
          const overlap = [...contentWords(source.body)].filter((word) => questionWords.has(word)).length;
          return { ...source, overlap };
        })
        .filter((source) => source.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap);

      if (scored.length === 0) {
        return {
          text: INSUFFICIENT_CONTEXT_SENTINEL,
          inputTokens: estimateTokens(request.user),
          outputTokens: estimateTokens(INSUFFICIENT_CONTEXT_SENTINEL),
        };
      }

      const parts = scored.slice(0, 2).map((source) => {
        const sentences = source.body
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim())
          .filter((sentence) => sentence.length > 0);

        const best =
          sentences
            .map((sentence) => ({
              sentence,
              overlap: [...contentWords(sentence)].filter((word) => questionWords.has(word)).length,
            }))
            .sort((a, b) => b.overlap - a.overlap)[0]?.sentence ?? sentences[0] ?? source.body;

        return `${best} [${source.marker}]`;
      });

      const text = parts.join(' ');
      return {
        text,
        inputTokens: estimateTokens(request.user),
        outputTokens: estimateTokens(text),
      };
    },
  };
}
