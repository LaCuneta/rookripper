export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["icons/icon-192.png","icons/icon-512.png","icons/icon.svg"]),
	mimeTypes: {".png":"image/png",".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.CAYrpEFt.js",app:"_app/immutable/entry/app.BhZW-UtZ.js",imports:["_app/immutable/entry/start.CAYrpEFt.js","_app/immutable/chunks/By8SQ_Tp.js","_app/immutable/chunks/DPMc_6a3.js","_app/immutable/chunks/B7XertQJ.js","_app/immutable/chunks/CIuliPtR.js","_app/immutable/entry/app.BhZW-UtZ.js","_app/immutable/chunks/DPMc_6a3.js","_app/immutable/chunks/BphQ8H0Y.js","_app/immutable/chunks/D1arq4CJ.js","_app/immutable/chunks/CIuliPtR.js","_app/immutable/chunks/DhC8X7tL.js","_app/immutable/chunks/BmW3aegm.js","_app/immutable/chunks/Dw1_Bbg0.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js')),
			__memo(() => import('./nodes/3.js')),
			__memo(() => import('./nodes/4.js')),
			__memo(() => import('./nodes/5.js'))
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
				id: "/review",
				pattern: /^\/review\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 3 },
				endpoint: null
			},
			{
				id: "/settings",
				pattern: /^\/settings\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 4 },
				endpoint: null
			},
			{
				id: "/setup",
				pattern: /^\/setup\/?$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 5 },
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
