import { defineConfig } from 'vitest/config';

// Core logic is pure JS + three (no DOM), so the lighter node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
