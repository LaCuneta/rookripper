import * as server from '../entries/pages/_page.server.ts.js';

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/+page.server.ts";
export const imports = ["_app/immutable/nodes/2.BUXUQ5LK.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/B3QZw0BC.js","_app/immutable/chunks/CifqU1td.js","_app/immutable/chunks/Bzgqamca.js","_app/immutable/chunks/BtQiOCjH.js","_app/immutable/chunks/CXYOz2Ub.js"];
export const stylesheets = ["_app/immutable/assets/2.CvmuVjqN.css"];
export const fonts = [];
