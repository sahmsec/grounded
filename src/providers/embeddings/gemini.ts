import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '../../errors/index.ts';
import { toProviderError } from '../errors.ts';
import type { EmbeddingProvider } from './types.ts';

/**
 * Documents and queries are embedded with *different* task types on purpose.
 * The asymmetry is what lets a short question retrieve a long passage that
 * shares meaning but almost no wording — it is the main reason paraphrased
 * questions work at all.
 */
type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export function createGeminiEmbeddings(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  const client = new GoogleGenAI({ apiKey });

  async function embed(texts: string[], taskType: TaskType): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response;
    try {
      response = await client.models.embedContent({
        model,
        contents: texts,
        config: { taskType, outputDimensionality: dimensions },
      });
    } catch (error) {
      throw toProviderError('gemini', error);
    }

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new ProviderError(
        'gemini',
        'server',
        `Expected ${texts.length} embeddings, received ${embeddings.length}`,
      );
    }

    return embeddings.map((entry, index) => {
      const values = entry.values;
      if (!Array.isArray(values) || values.length !== dimensions) {
        throw new ProviderError(
          'gemini',
          'server',
          `Embedding ${index} has ${values?.length ?? 0} dimensions, expected ${dimensions}`,
        );
      }
      // Reduced-dimension Gemini embeddings are truncated rather than
      // renormalised, so cosine distance is only meaningful after this.
      return normalise(values);
    });
  }

  return {
    name: 'gemini',
    model,
    dimensions,
    embedDocuments: (texts) => embed(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: async (text) => {
      const [vector] = await embed([text], 'RETRIEVAL_QUERY');
      if (!vector) throw new ProviderError('gemini', 'server', 'No embedding returned for query');
      return vector;
    },
  };
}

function normalise(values: number[]): number[] {
  let sumSquares = 0;
  for (const value of values) sumSquares += value * value;
  if (sumSquares === 0) return values;
  const magnitude = Math.sqrt(sumSquares);
  return values.map((value) => value / magnitude);
}
