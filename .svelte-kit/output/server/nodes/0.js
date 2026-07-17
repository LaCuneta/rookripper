

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const universal = {
  "ssr": false,
  "prerender": false,
  "load": null
};
export const universal_id = "src/routes/+layout.ts";
export const imports = ["_app/immutable/nodes/0.3u69YaZN.js","_app/immutable/chunks/AaPM13oZ.js","_app/immutable/chunks/rGJJnvTI.js","_app/immutable/chunks/CIuliPtR.js","_app/immutable/chunks/DPMc_6a3.js","_app/immutable/chunks/BKp_cI9r.js","_app/immutable/chunks/CJLu5a70.js","_app/immutable/chunks/Df2KvmPu.js","_app/immutable/chunks/D1arq4CJ.js","_app/immutable/chunks/DhC8X7tL.js","_app/immutable/chunks/BSX2dNFl.js","_app/immutable/chunks/C9jouxwD.js","_app/immutable/chunks/DEBuufv1.js"];
export const stylesheets = ["_app/immutable/assets/0.BzTSNHaK.css"];
export const fonts = [];
