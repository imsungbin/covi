import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Tests spawn git, servers, and browsers: isolate them in forked processes.
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Keep CI logs readable; failures still print full diffs.
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
