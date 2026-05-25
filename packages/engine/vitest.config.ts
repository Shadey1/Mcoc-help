import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    include: [
      '__tests__/**/*.test.ts',         // existing top-level engine tests
      'src/**/__tests__/**/*.test.ts',  // co-located module tests (e.g. relics)
    ],
  },
});
