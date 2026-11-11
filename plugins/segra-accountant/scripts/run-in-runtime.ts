// Runs the segra-accountant plugin through core's real plugin loader in its
// default worker-thread mode and calls every tool through what the loader
// returns.
//
// Run from the repo root:
//   bun plugins/segra-accountant/scripts/run-in-runtime.ts [plugin-dir]
//
// Safety: the script creates its own temp CLINE_DIR (never ~/.cline or
// ~/.segra-desktop) and removes it at the end. It imports core by path
// because @cline/core is not linked into the repo-root node_modules.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Optional argv[2]: plugin directory to test (default: this plugin folder),
// e.g. a copy made by `cline plugin install`.
const repoRoot = resolve(here, "..", "..", "..");
const pluginDir = process.argv[2] ? resolve(process.argv[2]) : resolve(here, "..");
const tmp = mkdtempSync(join(tmpdir(), "accountant-runtime-"));
process.env.CLINE_DIR = join(tmp, "cline-dir");
mkdirSync(process.env.CLINE_DIR, { recursive: true });
delete process.env.CLINE_PLUGIN_MODE; // force the default (worker) mode

const core: any = await import(join(repoRoot, "sdk/packages/core/dist/index.js"));

type Row = { name: string; ok: boolean; ms: number; detail: string };
const rows: Row[] = [];
const ms = (t: number) => Math.round(performance.now() - t);

// Scratch probe plugin: reports which thread plugin code runs on. It lives in
// the temp dir, not in the plugin under test.
const probePath = join(tmp, "thread-probe.ts");
writeFileSync(
	probePath,
	`import { isMainThread, threadId } from "node:worker_threads";
export default {
  name: "thread-probe",
  manifest: { capabilities: ["tools"] },
  setup(api) {
    api.registerTool({
      name: "thread_probe",
      description: "probe",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ({ isMainThread, threadId, pid: process.pid }),
    });
  },
};
`,
);

async function load(path: string) {
	const t0 = performance.now();
	const res = await core.resolveAndLoadAgentPlugins({
		pluginPaths: [path],
		cwd: tmp,
		mode: "worker",
	});
	const importMs = ms(t0);
	if (res.failures?.length || !res.extensions?.length) {
		throw new Error(`load failed: ${JSON.stringify(res.failures ?? res.issues)}`);
	}
	const t1 = performance.now();
	const tools: any[] = [];
	const ext = res.extensions[0];
	await ext.setup(
		{
			registerTool: (t: any) => tools.push(t),
			registerCommand() {}, registerMessageBuilder() {}, registerRule() {},
			registerProvider() {}, registerAutomationEventType() {}, registerMcpServer() {},
		},
		{ cwd: tmp },
	);
	return { res, ext, tools, importMs, setupMs: ms(t1) };
}

async function call(tools: any[], name: string, input: unknown) {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`tool ${name} not registered`);
	return tool.execute(input, { agentId: "spike", conversationId: "spike", iteration: 1 });
}

async function run(name: string, fn: () => Promise<string>) {
	const t = performance.now();
	try {
		const detail = await fn();
		rows.push({ name, ok: true, ms: ms(t), detail });
	} catch (e: any) {
		rows.push({ name, ok: false, ms: ms(t), detail: String(e?.message ?? e) });
	}
	const r = rows[rows.length - 1];
	console.log(`${r.ok ? "PASS" : "FAIL"}  ${String(r.ms).padStart(6)} ms  ${r.name}  ${r.detail.slice(0, 200)}`);
}

const textOf = (r: any) => (r?.pages ?? []).map((p: any) => `${p.text}`).join("\n");

try {
	// --- probe: prove the worker thread ---
	const probe = await load(probePath);
	const info = await call(probe.tools, "thread_probe", {});
	console.log(`probe plugin: import ${probe.importMs} ms, setup ${probe.setupMs} ms; plugin thread = ${JSON.stringify(info)}; host isMainThread=${(await import("node:worker_threads")).isMainThread} host pid=${process.pid}`);
	const info2 = info?.output ?? info;
	await probe.res.shutdown?.();

	// --- the real plugin ---
	const p = await load(join(pluginDir, "index.ts"));
	console.log(`segra-accountant: loader (import+worker start) ${p.importMs} ms, setup() ${p.setupMs} ms, tools: ${p.tools.map((t) => t.name).join(", ")}`);
	const T = p.tools;

	await run("accountant_ping", async () => {
		const r = await call(T, "accountant_ping", {});
		if (!JSON.stringify(r).includes('"ok":true')) throw new Error(JSON.stringify(r));
		return JSON.stringify(r);
	});

	const xlsx = join(tmp, "out.xlsx");
	await run("write_workbook (SUM formula)", async () => {
		const r = await call(T, "write_workbook", {
			path: xlsx,
			sheets: [{ name: "S", cells: [
				{ ref: "A1", value: 1 }, { ref: "A2", value: 2 }, { ref: "A3", formula: "SUM(A1:A2)" },
			] }],
		});
		if (!existsSync(xlsx)) throw new Error("file missing: " + JSON.stringify(r));
		const buf = await Bun.file(xlsx).bytes();
		if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not a zip");
		const ExcelJS: any = (await import(join(pluginDir, "node_modules/exceljs/lib/exceljs.nodejs.js"))).default;
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(xlsx);
		const f = wb.getWorksheet("S").getCell("A3").value;
		if (!f?.formula?.includes("SUM(A1:A2)")) throw new Error("formula lost: " + JSON.stringify(f));
		return `${statSync(xlsx).size} bytes, A3 formula=${f.formula}`;
	});

	for (const f of ["t4-text.pdf", "t4-scan.png", "t4-scan.pdf", "two-page-mixed.pdf"]) {
		await run(`read_document ${f}`, async () => {
			const r = await call(T, "read_document", { path: join(pluginDir, "fixtures", f) });
			const txt = textOf(r);
			if (!txt.includes("68,450.00")) throw new Error("68,450.00 not found in: " + txt.slice(0, 200));
			const src = (r.pages ?? []).map((q: any) => q.source).join(",");
			return `sources=[${src}] pages=${r.pages?.length}`;
		});
	}

	for (const [label, path] of [["locked.pdf", join(pluginDir, "fixtures/locked.pdf")], ["missing path", join(tmp, "nope.pdf")]] as const) {
		const t = performance.now();
		try {
			const r = await call(T, "read_document", { path });
			console.log(`RETURNED (no throw)  ${ms(t)} ms  read_document ${label}: ${JSON.stringify(r).slice(0, 300)}`);
			rows.push({ name: `read_document ${label} (error case)`, ok: true, ms: ms(t), detail: "returned: " + JSON.stringify(r).slice(0, 300) });
		} catch (e: any) {
			const d = `THREW ${e?.constructor?.name}: ${e?.message}`;
			console.log(`${d}  ${ms(t)} ms  read_document ${label}`);
			rows.push({ name: `read_document ${label} (error case)`, ok: true, ms: ms(t), detail: d });
		}
	}
	await p.res.shutdown?.();
	console.log(`\nworker-mode thread evidence: plugin code isMainThread=${JSON.stringify(info2?.isMainThread)} threadId=${info2?.threadId} (host pid ${process.pid}, plugin pid ${info2?.pid})`);
	const failed = rows.filter((r) => !r.ok);
	console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
	process.exitCode = failed.length ? 1 : 0;
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
