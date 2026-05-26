import * as server from '../entries/pages/review/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/review/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/review/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.Dw3gLdrC.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/B3QZw0BC.js","_app/immutable/chunks/CifqU1td.js","_app/immutable/chunks/Bzgqamca.js","_app/immutable/chunks/BtQiOCjH.js","_app/immutable/chunks/CXYOz2Ub.js","_app/immutable/chunks/n5-L3qON.js","_app/immutable/chunks/CcxYLlVR.js"];
export const stylesheets = ["_app/immutable/assets/3.bTVYt8mg.css"];
export const fonts = [];
