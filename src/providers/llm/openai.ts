/**
 * OpenAI chat completions over plain fetch.
 *
 * The official SDK would add a dependency for one HTTP call, and the pool
 * needs the raw status code anyway to classify failures correctly.
 */

import { ProviderError } from '../../errors/index.ts';
import { classifyStatus, extractRetryAfterMs, toProviderError } from '../errors.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiLlm(apiKey: string, model: string): LlmProvider {
  return {
    name: 'openai',
    model,

    async generate(request: LlmRequest): Promise<LlmResponse> {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: request.model ?? model,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            max_completion_tokens: request.maxTokens,
            temperature: request.temperature,
          }),
        });
      } catch (error) {
        throw toProviderError('openai', error);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ProviderError('openai', classifyStatus(response.status), `openai: ${response.status} ${body.slice(0, 300)}`, {
          status: response.status,
          retryAfterMs:
            extractRetryAfterMs({ headers: { 'retry-after': response.headers.get('retry-after') } }) ??
            extractRetryAfterMs({ message: body }),
        });
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const text = payload.choices?.[0]?.message?.content;

      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new ProviderError('openai', 'server', 'OpenAI returned an empty completion');
      }

      return {
        text,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      };
    },
  };
}
