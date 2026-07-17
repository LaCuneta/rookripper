

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/settings/_page.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false,
  "load": null
};
export const universal_id = "src/routes/settings/+page.ts";
export const imports = ["_app/immutable/nodes/4.BYMIhIXc.js","_app/immutable/chunks/D1arq4CJ.js","_app/immutable/chunks/DPMc_6a3.js","_app/immutable/chunks/CIuliPtR.js","_app/immutable/chunks/DhC8X7tL.js","_app/immutable/chunks/DaVGDi6o.js","_app/immutable/chunks/CJLu5a70.js","_app/immutable/chunks/DtEihg2J.js"];
export const stylesheets = ["_app/immutable/assets/4.DFa1z-5b.css"];
export const fonts = [];
