import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Deliberately not the SvelteKit vite config: these are pure-logic tests over
// src/lib and pulling in the kit plugin would demand a full `svelte-kit sync`.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts']
  }
});
