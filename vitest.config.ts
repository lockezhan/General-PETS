import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    setupFiles: [resolve(__dirname, './src/tests/setup.ts')],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
