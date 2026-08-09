import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests talk to Postgres and embed a whole seed corpus.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The integration suite shares one database, so parallel files would
    // truncate each other's data mid-assertion.
    fileParallelism: false,
    reporters: ['default'],
  },
});
