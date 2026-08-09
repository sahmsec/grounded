import { createApp, SEED_DIR } from '../src/app.ts';
import { loadSeedDocuments } from '../src/ingest/loader.ts';

const app = await createApp();

try {
  const documents = await loadSeedDocuments(SEED_DIR);
  process.stdout.write(`Loading ${documents.length} seed documents from ${SEED_DIR}\n`);

  const results = await app.ingestion.ingestAll(documents);

  let indexed = 0;
  let unchanged = 0;
  let chunks = 0;

  for (const result of results) {
    if (result.status === 'indexed') {
      indexed += 1;
      chunks += result.chunks;
    } else {
      unchanged += 1;
    }
    process.stdout.write(`  ${result.status.padEnd(9)} ${result.slug} (${result.chunks} chunks)\n`);
  }

  process.stdout.write(
    `\nIndexed ${indexed}, unchanged ${unchanged}. ${chunks} chunks written. ` +
      `Corpus now holds ${await app.chunks.count()} chunks across ${await app.documents.count()} documents.\n`,
  );
} finally {
  await app.close();
}
