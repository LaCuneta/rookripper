import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully static SPA: no route is prerendered (data is client-only), so every
    // path is served through the fallback shell and hydrated in the browser.
    adapter: adapter({ fallback: '200.html' })
  }
};

export default config;
