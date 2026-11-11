# segra-accountant: runtime spike report

Date: 2026-11-11. Host: Linux x86_64, Bun 1.4.3. Compiled binary: `apps/examples/desktop-app/src-tauri/bin/cline-cli-x86_64-unknown-linux-gnu` (built Nov 7, CLI 3.0.73, core 0.0.95; it may be older than the current source).

Reproduce worker mode from the repo root:

    bun plugins/segra-accountant/scripts/run-in-runtime.ts [plugin-dir]

The script makes its own temp `CLINE_DIR`, loads the plugin through core's `resolveAndLoadAgentPlugins` in `worker` mode, calls each tool, and deletes the temp dir. It imports core by path (`sdk/packages/core/dist/index.js`) because `@cline/core` is not linked into the repo-root `node_modules`. No rebuild of the SDK was needed.

## Results

Times are wall time per call. "Worker, source" = core loader from source `dist/`, system Bun. "Compiled Bun" = the same script run by the compiled binary's embedded Bun 1.4.3 (`BUN_BE_BUN=1`), against a copy of the plugin made by `plugin install`; it still uses core from `sdk/.../dist`, not the core inside the binary.

| Tool / case | Plain Bun | Worker, source | Compiled Bun runtime (installed copy) | Compiled binary, real hub |
|---|---|---|---|---|
| plugin import + worker start | n/a | 570-870 ms (limit 4 s) | 581 ms | plugin `ready` in hub; reload 1.1 s total |
| `accountant_ping` | works | works, 1 ms | works, 1 ms | listed; not executed |
| `write_workbook` (SUM formula, valid xlsx, formula kept) | works (tests) | works, 270 ms | works, 264 ms | listed; not executed |
| `read_document t4-text.pdf` | works, 223 ms | works, 231 ms | works, 221 ms | listed; not executed |
| `read_document t4-scan.png` (OCR) | works, 557 ms | works, 532 ms | works, 560 ms | not executed |
| `read_document t4-scan.pdf` (OCR) | works, 581 ms | works, 562 ms | works, 558 ms | not executed |
| `read_document two-page-mixed.pdf` | works, 589 ms | works, 564 ms | works, 554 ms | not executed |
| `read_document locked.pdf` | n/a | throws | throws | not executed |
| `read_document` missing path | n/a | throws | throws | not executed |

All four content fixtures contain "68,450.00" when read through the worker. `bun test` in the plugin folder: 32 pass, 0 fail.

Errors as they arrive at the caller (a normal `Error` with the plugin's message; the thread boundary keeps the message):

- locked.pdf: `Error: locked.pdf is password-protected. Ask the user for an unlocked copy; this tool cannot open encrypted PDFs.`
- missing path: `Error: File not found: <path>`

## Q1. Worker mode

Evidence of a worker thread: a scratch probe plugin (in the temp dir, not in the repo) returned `isMainThread: false, threadId: 1` from inside the loader while the host reported `isMainThread: true` (same pid, since workers are threads). The real plugin goes through the same loader path. Import plus worker start was 570-870 ms; `setup()` was under 1 ms because heavy libraries (pdfjs, tesseract, exceljs) are imported lazily on the first call. The 4 s import limit is not at risk.

## Q2. Nested tesseract worker

It works. OCR from inside the plugin worker thread started, recognised and terminated for PNG, scanned PDF and mixed PDF, with timings equal to plain Bun. No hang. The custom `document-ocr-worker.cjs` entry (network block plus `wasm-feature-detect` stub) runs fine nested. A strace of OCR showed tesseract loads only `tesseract-core-relaxedsimd.js` and `.wasm` here.

## Q3. Compiled binary

- Config isolation: with `CLINE_DIR` set, all files (plugins, data, db, tasks, cron) appeared under it. The hub is not isolated by `CLINE_DIR` alone: the binary's default hub port may be the live app's 25473, so I set `CLINE_HUB_PORT=25999` for every hub command and checked the port was free first. The live hub (pid 1163937) was untouched.
- `plugin install <local path> --json`: succeeded in 6.7 s. It copies the whole folder, including the source `node_modules`, `fixtures/` and `scripts/`, to `plugins/_installed/local/segra-accountant-<hash>/package/`, then runs **npm**: `npm install --omit=dev --omit=peer --legacy-peer-deps --no-audit --no-fund --package-lock=false`. A first attempt with a fake `npm` that exits 99 failed with `npm install ... failed with exit code 99`, so install needs a real `npm` on PATH. After install the folder is 177 MB (`node_modules` 173 MB, 185 top-level entries; `pdf-lib` dev dependency absent, linux-x64-gnu canvas present, musl absent). npm probably had a warm cache; a cold install time was not measured.
- `config tools --json`: lists `accountant_ping`, `read_document`, `write_workbook`, all `"type":"plugin","pluginName":"segra-accountant","enabled":true`.
- `hub plugins` (against a hub I started with `hub start --port 25999`): `state: ready, errorCount: 0, timeoutCount: 0, capabilities: ["tools"]`. No `plugin_failure`. `--reload segra-accountant` also returned `ready` (1.1 s). Note this binary only accepts `--cline-hub-daemon` as an internal flag; `hub start` is the working way to start a hub.
- Executing tools in the compiled binary: **not possible without a model.** The CLI has no tool-invoke, test or debug subcommand, and the hub's commands only cover `plugins.list|status|reload`; tool calls come from an agent session. What I could do: run my script under the binary's embedded Bun (`BUN_BE_BUN=1 <binary> run-in-runtime.ts <installed copy>`). That proves the plugin, its npm-installed dependencies, and pdfjs, tesseract and exceljs all work on the compiled Bun runtime, inside a worker. It does not prove they work through the binary's own bundled core/plugin-runtime and a real session.

## What failed

Nothing failed in any test. Notable limits found:

- Calling a tool from a script required driving `extension.setup(api)` with a collecting API; the loader returns the plugin, not a tool list.
- `@cline/core` does not resolve from the repo root (no workspace link), so the script imports by path.

## Not verified

- Tool execution through the compiled binary's own core in a real agent session (needs a model).
- Behaviour on macOS and Windows (native `@napi-rs/canvas` is per-platform; only linux-x64-gnu was installed and tested).
- Cold `npm install` time and download size; install behaviour when the target machine has no `npm`.
- Whether trimming files (below) breaks anything; sizes are measured, trimming was not tried.
- Tool calls after the 60 s default: `read_document` sets 300 s and `write_workbook` 120 s; the timeouts were not exercised with a slow job.

## Sizes (installed copy, production dependencies)

| Item | Size |
|---|---|
| Whole installed plugin folder | 177 MB |
| `node_modules` | 173 MB |
| `tesseract.js-core` | 44 MB (6 variants x js/wasm/wasm.js) |
| `@napi-rs/canvas-linux-x64-gnu` (native, per platform) | 36 MB |
| `pdfjs-dist` | 36 MB (legacy 16 MB, modern `build/` 12 MB, rest 8 MB) |
| `exceljs` | 22 MB |
| `es-abstract` (transitive) | 11 MB |
| `data/eng.traineddata.gz` | 2.9 MB |
| `fixtures/` + `scripts/` + `tools/` | 0.4 MB |

Dev checkout `node_modules` is 293 MB (also holds musl canvas and `pdf-lib`).

Possible cuts, not tried: leave out `fixtures/` and `scripts/` (0.4 MB); pdfjs `build/` (modern, 12 MB; code imports `legacy/build/pdf.mjs` only), `web/`, `types/` (about 5 MB); tesseract `*-lstm*` and `*.wasm.js` files (about 30 MB of the 44 MB; this machine used only `tesseract-core-relaxedsimd.js` and `.wasm`, but machines without relaxed SIMD fall back to `simd` and plain, so keep those three js+wasm pairs); `@types`, `es-abstract` if exceljs does not need them at runtime. Estimated result around 120 MB uncompressed, of which 36 MB is the platform-specific canvas addon.

## Recommendation

Choose (a): everything as plugin tools in the worker. Reasons: all three tools ran correctly in worker mode on the source loader and on the compiled Bun runtime, including OCR in a nested worker, with timings equal to plain Bun; import is about 0.6 s against a 4 s limit because heavy libraries load lazily; the hub reports the installed plugin as `ready` with no failure. Option (b) would add a process to supervise and a protocol to maintain, and nothing measured calls for it.

Conditions before shipping: (1) test one real agent turn in the packaged app (the only unverified path); (2) decide how dependencies get installed, since `plugin install` shells out to `npm`, which end users may not have: ship the plugin pre-installed per platform instead of installing at runtime; (3) build per platform because of the native canvas addon; (4) apply the size cuts after re-running `run-in-runtime.ts` against the trimmed folder. If the packaged app cannot ship a pre-installed 120 MB folder, then (b) or dropping OCR for scanned PDFs becomes worth reconsidering.

## Code changes

Only new files: `scripts/run-in-runtime.ts` and this report. No changes to `tools/*.ts` or the `.cjs` worker. Pre-existing `.gitignore` change and `plugins/` untracked state were not touched by me.
