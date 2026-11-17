// Starts claude-mem's MCP search server for Segra. claude-mem installs into a
// versioned folder that changes on every update, so resolve the newest one.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const configDir =
	process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const cacheDir = path.join(
	configDir,
	"plugins",
	"cache",
	"thedotmack",
	"claude-mem",
);
const parse = (name) =>
	name
		.split("-")[0]
		.split(".")
		.map((n) => Number.parseInt(n, 10) || 0);
const newerFirst = (a, b) => {
	const x = parse(a);
	const y = parse(b);
	return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
};
let versions = [];
try {
	versions = fs
		.readdirSync(cacheDir)
		.filter(
			(name) =>
				/^\d/.test(name) &&
				!fs.existsSync(path.join(cacheDir, name, ".orphaned_at")),
		)
		.sort(newerFirst);
} catch {}
const candidates = [
	...versions.map((v) => path.join(cacheDir, v)),
	path.join(configDir, "plugins", "marketplaces", "thedotmack", "plugin"),
];
const script = candidates
	.map((root) => path.join(root, "scripts", "mcp-server.cjs"))
	.find((candidate) => fs.existsSync(candidate));
if (script) {
	require(script);
} else {
	process.stderr.write(
		"claude-mem: MCP server not found. Is claude-mem installed for Claude Code?\n",
	);
	process.exit(1);
}
