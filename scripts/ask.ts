/** One-shot CLI: node scripts/ask.ts "what is sql injection?" */

import { createApp } from '../src/app.ts';

const question = process.argv.slice(2).join(' ').trim();

if (question.length === 0) {
  process.stderr.write('Usage: node scripts/ask.ts "your question"\n');
  process.exit(1);
}

const app = await createApp();

try {
  const result = await app.answers.ask(question);

  process.stdout.write(`\nQ: ${question}\n\n`);
  process.stdout.write(`${result.text}\n\n`);

  if (result.citations.length > 0) {
    process.stdout.write('Sources:\n');
    for (const citation of result.citations) {
      process.stdout.write(
        `  [${citation.marker}] ${citation.documentTitle} — ${citation.source} ` +
          `(chunk ${citation.chunkIndex}, score ${citation.similarity.toFixed(4)})\n`,
      );
    }
    process.stdout.write('\n');
  }

  const score = result.topSimilarity === null ? 'none' : result.topSimilarity.toFixed(4);
  process.stdout.write(
    `answered=${result.answered} reason=${result.reason} topScore=${score} ` +
      `modelCalled=${!result.refusedWithoutModelCall} latency=${result.meta.latencyMs}ms\n`,
  );
} finally {
  await app.close();
}
