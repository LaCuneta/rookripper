import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Served from https://lacuneta.github.io/rookripper/ in production, but from the
// root under `vite dev`. BASE_PATH overrides both (set it empty for a root deploy).
const dev = process.argv.includes('dev');
const base = process.env.BASE_PATH ?? (dev ? '' : '/rookripper');

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully static SPA: no route is prerendered (data is client-only), so every
    // path is served through the fallback shell and hydrated in the browser.
    // GitHub Pages has no 200.html concept — it serves 404.html for unmatched paths.
    adapter: adapter({ fallback: '404.html' }),
    paths: { base }
  }
};

export default config;
