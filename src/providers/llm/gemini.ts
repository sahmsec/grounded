import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '../../errors/index.ts';
import { toProviderError } from '../errors.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts';

export function createGeminiLlm(apiKey: string, model: string): LlmProvider {
  const client = new GoogleGenAI({ apiKey });

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
            // Grounded extraction needs no deliberation, and on 2.5 Flash
            // thinking tokens are billed against maxOutputTokens — leaving it
            // on can consume the whole budget and return empty text.
            thinkingConfig: { thinkingBudget: 0 },
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
