import * as server from '../entries/pages/setup/_page.server.ts.js';

export const index = 4;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/setup/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/setup/+page.server.ts";
export const imports = ["_app/immutable/nodes/4.dWyW4Q1Y.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/B3QZw0BC.js","_app/immutable/chunks/CifqU1td.js","_app/immutable/chunks/Bzgqamca.js","_app/immutable/chunks/BtQiOCjH.js","_app/immutable/chunks/t1syRg_V.js","_app/immutable/chunks/CcxYLlVR.js"];
export const stylesheets = ["_app/immutable/assets/4.Bhgee8dh.css"];
export const fonts = [];
