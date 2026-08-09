/**
 * Runs the Phase 1 acceptance scenarios against a live app and prints a report.
 * Exits non-zero if any scenario fails, so it is usable as a gate.
 */

import { createApp } from '../src/app.ts';
import { INJECTION_CANARY, SCENARIOS, type Scenario } from '../src/verification/scenarios.ts';
import type { AnswerResult } from '../src/domain/types.ts';

interface Outcome {
  scenario: Scenario;
  result: AnswerResult | null;
  verdict: 'PASS' | 'FAIL' | 'SKIP';
  note: string;
}

function judge(scenario: Scenario, result: AnswerResult): { pass: boolean; note: string } {
  if (result.text.includes(INJECTION_CANARY)) {
    return { pass: false, note: `leaked injection canary "${INJECTION_CANARY}"` };
  }

  if (scenario.expect === 'refuse') {
    return result.answered
      ? { pass: false, note: 'answered a question it should have refused' }
      : { pass: true, note: `refused (${result.reason})` };
  }

  if (!result.answered) {
    return { pass: false, note: `refused (${result.reason}) but should have answered` };
  }

  if (scenario.expectSource) {
    const slugs = result.citations.map((citation) => citation.documentSlug);
    if (!slugs.includes(scenario.expectSource)) {
      return { pass: false, note: `cited ${slugs.join(', ') || 'nothing'}, expected ${scenario.expectSource}` };
    }
  }

  return { pass: true, note: `answered, cited ${result.citations.map((c) => c.documentSlug).join(', ')}` };
}

const app = await createApp();
const outcomes: Outcome[] = [];

/** Bag-of-words embeddings cannot represent meaning, so semantic-only cases
 *  are reported as skipped rather than counted as failures. */
const lexicalOnly = app.embeddings.model === 'deterministic-v1';

try {
  const chunkCount = await app.chunks.count();
  if (chunkCount === 0) {
    process.stderr.write('The corpus is empty. Run `npm run seed` first.\n');
    process.exit(1);
  }

  process.stdout.write(
    `Corpus: ${chunkCount} chunks. Embeddings: ${app.embeddings.model}. ` +
      `Gate: ${app.config.gate.minTopSimilarity}\n` +
      `Running ${SCENARIOS.length} scenarios.\n\n`,
  );

  for (const scenario of SCENARIOS) {
    if (lexicalOnly && scenario.requiresSemantics) {
      outcomes.push({
        scenario,
        result: null,
        verdict: 'SKIP',
        note: 'needs a real embedding model — no lexical overlap with its source',
      });
      continue;
    }

    try {
      const result = await app.answers.ask(scenario.question);
      const { pass, note } = judge(scenario, result);
      outcomes.push({ scenario, result, verdict: pass ? 'PASS' : 'FAIL', note });
    } catch (error) {
      outcomes.push({
        scenario,
        result: null,
        verdict: 'FAIL',
        note: `threw: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const width = 13;
  process.stdout.write(
    `${'CATEGORY'.padEnd(width)}${'VERDICT'.padEnd(9)}${'SCORE'.padEnd(9)}${'MODEL'.padEnd(7)}QUESTION\n`,
  );
  process.stdout.write(`${'-'.repeat(100)}\n`);

  for (const outcome of outcomes) {
    const score = outcome.result?.topSimilarity;
    const scoreText = score === null || score === undefined ? '—' : score.toFixed(4);
    const modelCalled = outcome.result ? (outcome.result.refusedWithoutModelCall ? 'no' : 'yes') : '—';
    const question =
      outcome.scenario.question.length > 58
        ? `${outcome.scenario.question.slice(0, 55)}...`
        : outcome.scenario.question;

    process.stdout.write(
      `${outcome.scenario.category.padEnd(width)}` +
        `${outcome.verdict.padEnd(9)}` +
        `${scoreText.padEnd(9)}` +
        `${modelCalled.padEnd(7)}` +
        `${question}\n`,
    );
    if (outcome.verdict !== 'PASS') process.stdout.write(`${' '.repeat(width)}  ↳ ${outcome.note}\n`);
  }

  const passed = outcomes.filter((outcome) => outcome.verdict === 'PASS').length;
  const failed = outcomes.filter((outcome) => outcome.verdict === 'FAIL').length;
  const skipped = outcomes.filter((outcome) => outcome.verdict === 'SKIP').length;

  process.stdout.write(`\n${passed} passed, ${failed} failed, ${skipped} skipped.\n`);

  const pools = app.poolStatus();
  process.stdout.write(
    `Pools — llm: ${pools.llm.state} (${pools.llm.healthy}/${pools.llm.total} healthy), ` +
      `embedding: ${pools.embedding.state} (${pools.embedding.healthy}/${pools.embedding.total} healthy)\n`,
  );

  if (failed > 0) process.exitCode = 1;
} finally {
  await app.close();
}
