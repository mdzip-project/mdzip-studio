import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts (jsdom, used by `ng test` for the Angular
// renderer under src/). The Electron main-process modules in electron/lib are
// plain Node CommonJS with no Electron/DOM dependency, so they run in a plain
// node environment instead.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['electron/lib/**/*.test.js'],
  },
});
