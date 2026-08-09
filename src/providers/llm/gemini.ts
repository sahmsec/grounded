import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '../../errors/index.ts';
import { toProviderError } from '../errors.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts';

/**
 * Grounded extraction needs no deliberation, and thinking tokens are billed
 * against maxOutputTokens — leaving it on can consume the whole budget and
 * return empty text.
 *
 * The two model families disagree on how to say that. Gemini 2.x takes a
 * numeric `thinkingBudget` and rejects `thinkingLevel`; Gemini 3.x is the
 * reverse and returns a bare `400 INVALID_ARGUMENT` for the older field,
 * which looks like a malformed request rather than an unsupported option.
 */
function thinkingConfigFor(model: string): Record<string, unknown> {
  return /gemini-3/i.test(model) ? { thinkingLevel: 'LOW' } : { thinkingBudget: 0 };
}

export function createGeminiLlm(apiKey: string, model: string): LlmProvider {
  const client = new GoogleGenAI({ apiKey });
  const thinkingConfig = thinkingConfigFor(model);

  return {
    name: 'gemini',
    model,

    async generate(request: LlmRequest): Promise<LlmResponse> {
      let response;
      try {
        response = await client.models.generateContent({
          model,
          contents: request.user,
          config: {
            systemInstruction: request.system,
            maxOutputTokens: request.maxTokens,
            temperature: request.temperature,
            thinkingConfig,
          },
        });
      } catch (error) {
        throw toProviderError('gemini', error);
      }

      const text = response.text;
      if (typeof text !== 'string' || text.trim().length === 0) {
        // Usually a safety block or an exhausted output budget. Either way the
        // caller cannot ground an answer on it, so treat it as a real failure.
        throw new ProviderError('gemini', 'server', 'Gemini returned an empty completion', {
          cause: { finishReason: response.candidates?.[0]?.finishReason },
        });
      }

      const usage = response.usageMetadata;
      return {
        text,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      };
    },
  };
}
