/**
 * Asks a provider what its key can actually use.
 *
 * A hardcoded dropdown goes stale the moment a model is retired, which is how
 * a dead model reaches production. Listing live means the operator picks from
 * what exists today.
 */

import { toProviderError } from '../providers/errors.ts';

export interface ModelOption {
  id: string;
  /** Whether it can answer questions, embed text, or both. */
  kinds: Array<'generation' | 'embedding'>;
}

/** Variants that cannot answer a text question, so they only add noise. */
const NON_TEXT = /(tts|image|robotics|lyria|nano-banana|computer-use|veo|imagen)/i;

async function listGemini(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
  );
  if (!response.ok) {
    throw toProviderError('gemini', new Error(`${response.status} ${await response.text()}`));
  }

  const payload = (await response.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };

  const options: ModelOption[] = [];
  for (const model of payload.models ?? []) {
    const id = model.name.replace(/^models\//, '');
    if (NON_TEXT.test(id)) continue;

    const methods = model.supportedGenerationMethods ?? [];
    const kinds: ModelOption['kinds'] = [];
    if (methods.includes('generateContent')) kinds.push('generation');
    if (methods.includes('embedContent')) kinds.push('embedding');
    if (kinds.length > 0) options.push({ id, kinds });
  }

  return options;
}

/**
 * Anything speaking the OpenAI protocol — OpenAI itself, DeepSeek, Zhipu,
 * Qwen, SiliconFlow, OpenRouter, a local Ollama. The listing endpoint does not
 * say which models embed, so that is inferred from the name.
 */
async function listOpenAiCompatible(apiKey: string, baseUrl: string): Promise<ModelOption[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw toProviderError('openai', new Error(`${response.status} ${await response.text()}`));
  }

  const payload = (await response.json()) as { data?: Array<{ id: string }> };

  return (payload.data ?? [])
    .filter((model) => !NON_TEXT.test(model.id))
    .map((model) => ({
      id: model.id,
      kinds: /embed|bge|gte/i.test(model.id)
        ? (['embedding'] as ModelOption['kinds'])
        : (['generation'] as ModelOption['kinds']),
    }));
}

export const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
};

export async function listModels(provider: string, apiKey: string): Promise<ModelOption[]> {
  if (provider === 'gemini') return listGemini(apiKey);

  const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider];
  if (baseUrl) return listOpenAiCompatible(apiKey, baseUrl);

  // Offline providers have exactly one model and no endpoint to ask.
  if (provider === 'stub') return [{ id: 'stub-v1', kinds: ['generation'] }];
  if (provider === 'deterministic') return [{ id: 'deterministic-v1', kinds: ['embedding'] }];

  return [];
}
