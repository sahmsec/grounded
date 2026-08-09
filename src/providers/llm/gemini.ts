import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '../../errors/index.ts';
import { toProviderError } from '../errors.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts';

/**
 * Grounded extraction needs no deliberation, and thinking tokens are billed
 * against maxOutputTokens — leaving it on can consume the whole budget and
 * return empty text.
 *
 * The model families disagree on how to say that. Gemini 1.x and 2.x take a
 * numeric `thinkingBudget` and reject `thinkingLevel`; everything newer is the
 * reverse and returns a bare `400 INVALID_ARGUMENT` for the older field, which
 * reads as a malformed request rather than an unsupported option.
 *
 * The check is written as "old models opt out" rather than "new models opt in"
 * so that version aliases (`gemini-flash-latest`) and future releases get the
 * current field by default instead of failing until someone adds a case.
 *
 * Note that thinking tokens are charged against `maxOutputTokens`. Even at LOW
 * a reply can spend a couple of hundred on them, so a small output budget
 * yields an empty completion rather than a short one.
 */
function thinkingConfigFor(model: string): Record<string, unknown> {
  const legacy = /gemini-[12][.-]/i.test(model);
  return legacy ? { thinkingBudget: 0 } : { thinkingLevel: 'LOW' };
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
