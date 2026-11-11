// Entry point for the tesseract.js worker thread (passed as `workerPath`).
//
// 1. It shuts off every network route BEFORE the real tesseract worker script
//    loads, so OCR cannot reach the network even by mistake (if language data
//    were missing, tesseract.js would otherwise fall back to a CDN download).
// 2. It replaces the `wasm-feature-detect` package. Its CommonJS build contains
//    the syntax `import.source(...)`, which Bun 1.4.x cannot parse ("Expected
//    meta but found source"), so tesseract.js's worker crashes on startup under
//    Bun. We only need two of its checks (simd, relaxedSimd), reimplemented here
//    with the same WebAssembly.validate probes.
"use strict";

function blocked(what) {
	return () => {
		throw new Error(`Network access is disabled in the OCR worker (${what}).`);
	};
}

globalThis.fetch = blocked("fetch");
const net = require("node:net");
net.Socket.prototype.connect = blocked("net.Socket.connect");
net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");
require("node:dns").lookup = blocked("dns.lookup");

const probe = (bytes) => async () => WebAssembly.validate(new Uint8Array(bytes));
const stub = {
	simd: probe([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]),
	relaxedSimd: probe([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11]),
};
const wfdPath = require.resolve("wasm-feature-detect");
require.cache[wfdPath] = { id: wfdPath, filename: wfdPath, loaded: true, exports: stub, children: [], paths: [] };

require("tesseract.js/src/worker-script/node/index.js");
