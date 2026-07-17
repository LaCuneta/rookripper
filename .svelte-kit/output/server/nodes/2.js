

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false,
  "load": null
};
export const universal_id = "src/routes/+page.ts";
export const imports = ["_app/immutable/nodes/2.FRE7uRuI.js","_app/immutable/chunks/CJLu5a70.js","_app/immutable/chunks/DPMc_6a3.js","_app/immutable/chunks/C1Wb8IZn.js","_app/immutable/chunks/D1arq4CJ.js","_app/immutable/chunks/BphQ8H0Y.js","_app/immutable/chunks/DhC8X7tL.js","_app/immutable/chunks/DaVGDi6o.js","_app/immutable/chunks/BSX2dNFl.js","_app/immutable/chunks/BmW3aegm.js","_app/immutable/chunks/Df2KvmPu.js"];
export const stylesheets = ["_app/immutable/assets/2.BjqUYziJ.css"];
export const fonts = [];
