import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

// Segra Desktop's local models run on llama.cpp's own `llama-server`
// (sidecar/local-models.ts). This stages a pinned upstream build in
// src-tauri/bin/llama, bundled as a resource folder: the server finds its
// libraries next to itself ($ORIGIN / @loader_path), so it can't be a single
// externalBin. GPU builds: Metal on macOS, Vulkan elsewhere (any vendor; ggml
// falls back to the CPU when Vulkan is missing).

export const LLAMA_CPP_BUILD = "b11936";

type Archive = { asset: string; sha256: string };

const ARCHIVES: Record<string, Archive> = {
	"aarch64-apple-darwin": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-macos-arm64.tar.gz`,
		sha256: "21f835a2af2aa06345f10e3d8f054c1d94a6e7932401d9752e512b6a9133e845",
	},
	"x86_64-apple-darwin": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-macos-x64.tar.gz`,
		sha256: "ab88dd016ff560058ed56177f570572aa2bc5665f6cfbeb3f3bb20748eaa6864",
	},
	"x86_64-unknown-linux-gnu": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`,
		sha256: "9c1c795fc6aa77556f522bbe51a6ba6e9e448e11527adb9499f6229c1133caa8",
	},
	"aarch64-unknown-linux-gnu": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-ubuntu-vulkan-arm64.tar.gz`,
		sha256: "9a3d3c127107ee982655d6d12dea70076787118521fa6cdaae932bee19d2d36e",
	},
	"x86_64-pc-windows-msvc": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-win-vulkan-x64.zip`,
		sha256: "e327a84fd3f9b4bbd94441ce6d30a059bbaf5f16023951e598dbdbc284f0d409",
	},
	"aarch64-pc-windows-msvc": {
		asset: `llama-${LLAMA_CPP_BUILD}-bin-win-vulkan-arm64.zip`,
		sha256: "acef31bb9400001e1a3d2ea76d3a34293a3f1a782f6828c93e31c0823beea98d",
	},
};

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const LLAMA_DIR = join(APP_ROOT, "src-tauri", "bin", "llama");
const CACHE_DIR = join(APP_ROOT, "src-tauri", "target", "llama-cpp");

const isLibrary = (name: string) => /\.(so(\.\d+)*|dylib|dll)$/.test(name);
// One version component: the name binaries link against (libggml.so.0,
// libggml.0.dylib). Unversioned names are only for linking at build time.
const isLinkName = (name: string) => /\.so\.\d+$|\.\d+\.dylib$/.test(name);
// The other tools' implementation libraries; the server only needs its own.
const isOtherToolLibrary = (name: string) =>
	/-impl\.(so|dylib|dll)$/.test(name) && !name.includes("llama-server-impl");

/**
 * The files the server needs from an extracted release folder, as
 * output name → source path. Symlink chains collapse to one real copy under
 * the name binaries link against, so nothing is stored twice.
 */
export function selectEngineFiles(dir: string): Map<string, string> {
	const selected = new Map<string, string>();
	const nameByTarget = new Map<string, string>();
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		if (name === "llama-server" || name === "llama-server.exe") {
			selected.set(name, path);
			continue;
		}
		if (name.startsWith("LICENSE")) {
			selected.set(name, path);
			continue;
		}
		if (!isLibrary(name) || isOtherToolLibrary(name)) continue;
		const target = realpathSync(path);
		const current = nameByTarget.get(target);
		const isSymlink = lstatSync(path).isSymbolicLink();
		// Prefer the link name; otherwise the real file's own name.
		if (!current || isLinkName(name) || (!isSymlink && !isLinkName(current))) {
			if (current) selected.delete(current);
			nameByTarget.set(target, name);
			selected.set(name, target);
		}
	}
	return selected;
}

async function download(archive: Archive): Promise<string> {
	mkdirSync(CACHE_DIR, { recursive: true });
	const path = join(CACHE_DIR, archive.asset);
	const matches = () =>
		createHash("sha256").update(readFileSync(path)).digest("hex") ===
		archive.sha256;
	if (existsSync(path) && matches()) return path;
	const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}/${archive.asset}`;
	console.log(`Downloading ${url}`);
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	writeFileSync(path, Buffer.from(await response.arrayBuffer()));
	if (!matches()) {
		rmSync(path);
		throw new Error(`${archive.asset}: checksum mismatch`);
	}
	return path;
}

async function extract(targetTriple: string): Promise<Map<string, string>> {
	const archive = ARCHIVES[targetTriple];
	if (!archive) throw new Error(`no llama.cpp build for ${targetTriple}`);
	const file = await download(archive);
	const out = join(CACHE_DIR, `${LLAMA_CPP_BUILD}-${targetTriple}`);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	if (file.endsWith(".zip") && process.platform === "win32") {
		// Git's GNU tar can shadow Windows' bsdtar on PATH and can't read zip.
		await $`powershell -NoProfile -Command Expand-Archive -LiteralPath ${file} -DestinationPath ${out} -Force`;
	} else {
		await $`tar -xf ${file} -C ${out}`;
	}
	// Archives hold either the files or one top-level folder.
	const entries = readdirSync(out);
	const root =
		entries.length === 1 && lstatSync(join(out, entries[0])).isDirectory()
			? join(out, entries[0])
			: out;
	return selectEngineFiles(root);
}

/** Signs what Tauri won't: Mach-O files under Resources fail notarization unsigned. */
async function signMacFiles(dir: string) {
	const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || "-";
	for (const name of readdirSync(dir)) {
		if (name.startsWith("LICENSE") || name === ".build") continue;
		const path = join(dir, name);
		if (identity === "-") {
			await $`codesign --force --sign - ${path}`.quiet();
		} else {
			await $`codesign --force --options runtime --timestamp --sign ${identity} ${path}`.quiet();
		}
	}
}

export async function fetchLlamaServer(targetTriple: string): Promise<void> {
	const marker = join(LLAMA_DIR, ".build");
	const wanted = `${LLAMA_CPP_BUILD} ${targetTriple}`;
	if (existsSync(marker) && readFileSync(marker, "utf8").trim() === wanted) {
		return;
	}
	rmSync(LLAMA_DIR, { recursive: true, force: true });
	mkdirSync(LLAMA_DIR, { recursive: true });

	if (targetTriple === "universal-apple-darwin") {
		// Tauri lipos only its own binary: merge both slices file by file.
		const arm64 = await extract("aarch64-apple-darwin");
		const x64 = await extract("x86_64-apple-darwin");
		for (const [name, source] of arm64) {
			const output = join(LLAMA_DIR, name);
			const other = x64.get(name);
			if (name.startsWith("LICENSE") || !other) {
				copyFileSync(source, output);
			} else {
				await $`lipo -create -output ${output} ${source} ${other}`;
			}
		}
	} else {
		for (const [name, source] of await extract(targetTriple)) {
			copyFileSync(source, join(LLAMA_DIR, name));
		}
	}
	for (const name of readdirSync(LLAMA_DIR)) {
		if (!name.startsWith("LICENSE")) chmodSync(join(LLAMA_DIR, name), 0o755);
	}
	if (targetTriple.includes("apple-darwin")) await signMacFiles(LLAMA_DIR);
	writeFileSync(marker, `${wanted}\n`);
	console.log(
		`llama.cpp ${LLAMA_CPP_BUILD} for ${targetTriple}: ${readdirSync(LLAMA_DIR)
			.filter((name) => name !== ".build")
			.map((name) => basename(name))
			.join(", ")}`,
	);
}

async function main() {
	const targetTriple =
		process.argv[2] ??
		process.env.TAURI_ENV_TARGET_TRIPLE ??
		(await $`rustc -vV`.text())
			.split("\n")
			.find((line) => line.startsWith("host: "))
			?.slice("host: ".length)
			.trim();
	if (!targetTriple) throw new Error("pass a target triple");
	await fetchLlamaServer(targetTriple);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}
