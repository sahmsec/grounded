import { ProviderError } from '../../errors/index.ts';
import { classifyStatus, extractRetryAfterMs, toProviderError } from '../errors.ts';
import type { EmbeddingProvider } from './types.ts';

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

interface EmbeddingsResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

export function createOpenAiEmbeddings(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  async function embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts, dimensions }),
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

    const payload = (await response.json()) as EmbeddingsResponse;
    const rows = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);

    if (rows.length !== texts.length) {
      throw new ProviderError('openai', 'server', `Expected ${texts.length} embeddings, received ${rows.length}`);
    }

    return rows.map((row) => {
      if (row.embedding.length !== dimensions) {
        throw new ProviderError(
          'openai',
          'server',
          `Embedding has ${row.embedding.length} dimensions, expected ${dimensions}`,
        );
      }
      return row.embedding;
    });
  }

  return {
    name: 'openai',
    model,
    dimensions,
    embedDocuments: embed,
    embedQuery: async (text) => {
      const [vector] = await embed([text]);
      if (!vector) throw new ProviderError('openai', 'server', 'No embedding returned for query');
      return vector;
    },
  };
}
