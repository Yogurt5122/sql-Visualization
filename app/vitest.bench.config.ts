import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['benchmark/**/*.bench.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
