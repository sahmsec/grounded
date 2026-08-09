import { describe, expect, it, vi } from 'vitest';
import { createAnswerService } from '../../src/rag/answer-service.ts';
import { CANONICAL_REFUSAL, INSUFFICIENT_CONTEXT_SENTINEL } from '../../src/rag/protocol.ts';
import { ValidationError } from '../../src/errors/index.ts';
import { silentLogger } from '../../src/logging/logger.ts';
import type { Config } from '../../src/config/index.ts';
import type { ChunkRepository } from '../../src/db/repositories.ts';
import type { RetrievedChunk } from '../../src/domain/types.ts';
import type { LlmRequest, PooledEmbeddings, PooledLlm } from '../../src/providers/index.ts';

const CONFIG = {
  gate: { minTopSimilarity: 0.62, minChunkSimilarity: 0.55, maxContextChunks: 3, candidateLimit: 10 },
  llm: { maxOutputTokens: 512, temperature: 0.2 },
} as unknown as Config;

function chunk(similarity: number, slug = 'sql-injection'): RetrievedChunk {
  return {
    chunkId: `${slug}-0`,
    documentId: slug,
    documentSlug: slug,
    documentTitle: slug,
    source: 'handbook',
    chunkIndex: 0,
    content: `content about ${slug}`,
    similarity,
  };
}

function build(options: { candidates: RetrievedChunk[]; answer?: string }) {
  const generate = vi.fn(async (_request: LlmRequest) => ({
    text: options.answer ?? 'Parameterised queries prevent it [1].',
    inputTokens: 100,
    outputTokens: 20,
    provider: 'stub',
    credentialId: 'stub#1',
    model: 'stub-v1',
  }));

  const chunks = { search: vi.fn(async () => options.candidates) } as unknown as ChunkRepository;
  const embeddings = { embedQuery: vi.fn(async () => [0.1, 0.2]) } as unknown as PooledEmbeddings;
  const llm = { generate } as unknown as PooledLlm;

  const service = createAnswerService({ config: CONFIG, chunks, embeddings, llm, logger: silentLogger });
  return { service, generate, chunks, embeddings };
}

describe('answer service — refusal path', () => {
  it('refuses without calling the model when nothing clears the gate', async () => {
    const { service, generate } = build({ candidates: [chunk(0.3)] });

    const result = await service.ask('What is a good pasta recipe?');

    expect(result.answered).toBe(false);
    expect(result.text).toBe(CANONICAL_REFUSAL);
    expect(result.refusedWithoutModelCall).toBe(true);
    expect(result.reason).toBe('below_top_threshold');
    // The core guarantee: no tokens were spent deciding to refuse.
    expect(generate).not.toHaveBeenCalled();
  });

  it('refuses when retrieval returns nothing at all', async () => {
    const { service, generate } = build({ candidates: [] });

    const result = await service.ask('Who won the 2018 World Cup?');

    expect(result.answered).toBe(false);
    expect(result.reason).toBe('no_matches');
    expect(result.topSimilarity).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });

  it('reports the top score even when refusing, so the decision is auditable', async () => {
    const { service } = build({ candidates: [chunk(0.4123)] });

    const result = await service.ask('anything');

    expect(result.topSimilarity).toBeCloseTo(0.4123);
    expect(result.meta.candidatesConsidered).toBe(1);
  });

  it('converts the model’s insufficient-context sentinel into the same refusal', async () => {
    const { service, generate } = build({
      candidates: [chunk(0.8)],
      answer: INSUFFICIENT_CONTEXT_SENTINEL,
    });

    const result = await service.ask('What is our SOC 2 audit schedule?');

    expect(result.answered).toBe(false);
    expect(result.text).toBe(CANONICAL_REFUSAL);
    expect(result.reason).toBe('model_reported_insufficient_context');
    // The gate admitted it, so a call did happen — the model is the second gate.
    expect(result.refusedWithoutModelCall).toBe(false);
    expect(generate).toHaveBeenCalledOnce();
    expect(result.citations).toEqual([]);
  });
});

describe('answer service — answer path', () => {
  it('answers and cites when the gate admits the question', async () => {
    const { service, generate } = build({ candidates: [chunk(0.85)] });

    const result = await service.ask('What is SQL injection?');

    expect(result.answered).toBe(true);
    expect(result.text).toBe('Parameterised queries prevent it [1].');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ marker: 1, documentSlug: 'sql-injection' });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('sends only the chunks that survived the gate', async () => {
    const { service, generate } = build({
      candidates: [chunk(0.9, 'a'), chunk(0.6, 'b'), chunk(0.2, 'c')],
    });

    await service.ask('What is SQL injection?');

    const prompt = generate.mock.calls[0]![0]!.user;
    expect(prompt).toContain('content about a');
    expect(prompt).toContain('content about b');
    expect(prompt).not.toContain('content about c');
  });

  it('reports only the sources the model actually referenced', async () => {
    const { service } = build({
      candidates: [chunk(0.9, 'a'), chunk(0.8, 'b'), chunk(0.7, 'c')],
      answer: 'Only the first source matters here [1].',
    });

    const result = await service.ask('question');

    expect(result.citations.map((entry) => entry.documentSlug)).toEqual(['a']);
  });

  it('falls back to every supplied source when the model cites none', async () => {
    const { service } = build({
      candidates: [chunk(0.9, 'a'), chunk(0.8, 'b')],
      answer: 'An answer with no markers at all.',
    });

    const result = await service.ask('question');

    expect(result.citations).toHaveLength(2);
  });

  it('records which credential served the request', async () => {
    const { service } = build({ candidates: [chunk(0.9)] });

    const result = await service.ask('question');

    expect(result.meta).toMatchObject({
      provider: 'stub',
      credentialId: 'stub#1',
      model: 'stub-v1',
      inputTokens: 100,
      outputTokens: 20,
      chunksUsed: 1,
    });
  });

  it('requests candidates up to the configured limit', async () => {
    const { service, chunks } = build({ candidates: [chunk(0.9)] });

    await service.ask('question');

    expect(chunks.search).toHaveBeenCalledWith(expect.anything(), 10);
  });
});

describe('answer service — input validation', () => {
  it('rejects an empty question', async () => {
    const { service } = build({ candidates: [] });
    await expect(service.ask('   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an oversized question rather than embedding it', async () => {
    const { service, embeddings } = build({ candidates: [] });

    await expect(service.ask('x'.repeat(2001))).rejects.toBeInstanceOf(ValidationError);
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
  });
});
