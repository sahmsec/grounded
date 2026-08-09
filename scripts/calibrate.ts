/**
 * Prints the top similarity score each acceptance scenario actually produces,
 * grouped by whether it should be answered or refused.
 *
 * Thresholds are a property of the embedding model, not a universal constant,
 * so this is how they get chosen: run it, look at where the two groups
 * separate, and set the gate in the gap. Re-run it after any change of
 * embedding model.
 */

import { createApp } from '../src/app.ts';
import { silentLogger } from '../src/logging/logger.ts';
import { SCENARIOS } from '../src/verification/scenarios.ts';

const app = await createApp({ logger: silentLogger });

try {
  const rows: Array<{
    expect: string;
    category: string;
    score: number;
    top: string;
    question: string;
    semanticOnly: boolean;
  }> = [];

  for (const scenario of SCENARIOS) {
    const embedding = await app.embeddings.embedQuery(scenario.question);
    const results = await app.chunks.search(embedding, 3);
    rows.push({
      expect: scenario.expect,
      category: scenario.category,
      score: results[0]?.similarity ?? 0,
      top: results[0]?.documentSlug ?? '—',
      question: scenario.question,
      semanticOnly: scenario.requiresSemantics === true,
    });
  }

  // Semantic-only cases are excluded from the separability calculation when
  // the provider cannot represent meaning — including them would suggest no
  // threshold works, when in fact no *lexical* threshold works.
  const lexical = app.embeddings.model === 'deterministic-v1';
  const considered = lexical ? rows.filter((row) => !row.semanticOnly) : rows;

  const answerScores = considered.filter((row) => row.expect === 'answer').map((row) => row.score);
  const refuseScores = considered.filter((row) => row.expect === 'refuse').map((row) => row.score);

  process.stdout.write(`model: ${app.embeddings.model}\n\n`);
  process.stdout.write(`${'EXPECT'.padEnd(8)}${'CATEGORY'.padEnd(13)}${'SCORE'.padEnd(9)}${'TOP DOC'.padEnd(28)}QUESTION\n`);
  process.stdout.write(`${'-'.repeat(120)}\n`);

  for (const row of [...rows].sort((a, b) => b.score - a.score)) {
    process.stdout.write(
      `${row.expect.padEnd(8)}${row.category.padEnd(13)}${row.score.toFixed(4).padEnd(9)}` +
        `${row.top.padEnd(28)}${row.question.slice(0, 60)}\n`,
    );
  }

  const lowestAnswer = Math.min(...answerScores);
  const highestRefuse = Math.max(...refuseScores);

  process.stdout.write(`\nlowest  "answer" score : ${lowestAnswer.toFixed(4)}\n`);
  process.stdout.write(`highest "refuse" score : ${highestRefuse.toFixed(4)}\n`);

  if (lowestAnswer > highestRefuse) {
    const midpoint = (lowestAnswer + highestRefuse) / 2;
    process.stdout.write(`\nSeparable. Any gate in (${highestRefuse.toFixed(4)}, ${lowestAnswer.toFixed(4)}) works.\n`);
    process.stdout.write(`Suggested MIN_TOP_SIMILARITY=${midpoint.toFixed(2)}\n`);
  } else {
    process.stdout.write(
      `\nNOT separable by a single threshold: at least one question that must be refused ` +
        `outscores one that must be answered. No gate value can satisfy both.\n`,
    );
  }
} finally {
  await app.close();
}
