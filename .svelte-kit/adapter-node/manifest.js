export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["icons/icon.svg"]),
	mimeTypes: {".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.DIcwtc75.js",app:"_app/immutable/entry/app.B4FTrkpV.js",imports:["_app/immutable/entry/start.DIcwtc75.js","_app/immutable/chunks/t1syRg_V.js","_app/immutable/chunks/CcxYLlVR.js","_app/immutable/chunks/B3QZw0BC.js","_app/immutable/chunks/CifqU1td.js","_app/immutable/entry/app.B4FTrkpV.js","_app/immutable/chunks/B3QZw0BC.js","_app/immutable/chunks/CifqU1td.js","_app/immutable/chunks/Bzak7iHL.js","_app/immutable/chunks/CcxYLlVR.js","_app/immutable/chunks/Bzgqamca.js","_app/immutable/chunks/n5-L3qON.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/cloud-eval",
				pattern: /^\/api\/cloud-eval\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/cloud-eval/_server.ts.js'))
			},
			{
				id: "/api/review",
				pattern: /^\/api\/review\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/review/_server.ts.js'))
			},
			{
				id: "/api/sync",
				pattern: /^\/api\/sync\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/sync/_server.ts.js'))
			},
			{
				id: "/review",
				pattern: /^\/review\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/setup",
				pattern: /^\/setup\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();

export const prerendered = new Set([]);

export const base = "";