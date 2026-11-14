/** Desktop remote-server selection. Local mode stays the default. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { parseServerUrl, resolveClientConnection, readClientSettings, writeClientSettings } = require("../electron/client-connection.cjs");

describe("remote server URL", () => {
	it("accepts an origin and rejects paths, credentials, and other schemes", () => {
		assert.deepEqual(parseServerUrl(" https://spark.tail.ts.net/ "), { url: "https://spark.tail.ts.net" });
		assert.deepEqual(parseServerUrl("http://127.0.0.1:3000"), { url: "http://127.0.0.1:3000" });
		assert.deepEqual(parseServerUrl(""), { url: null });
		assert.equal(parseServerUrl("https://user:secret@spark.tail.ts.net").error, "Put the password in the server login, not the URL.");
		assert.equal(parseServerUrl("https://spark.tail.ts.net/learn").error, "Use the site root, without a path.");
		assert.equal(parseServerUrl("file:///tmp/learnharness").error, "Enter an http(s) URL.");
	});

	it("prefers the dev server, then the env URL, then the saved setting, then this Mac", () => {
		assert.equal(resolveClientConnection({ env: { LH_DEV_URL: "http://localhost:3000", LH_SERVER_URL: "https://spark.tail.ts.net" }, saved: { serverUrl: "https://other.example" } }).mode, "dev");
		assert.deepEqual(resolveClientConnection({ env: { LH_SERVER_URL: "https://spark.tail.ts.net" }, saved: { serverUrl: "https://other.example" } }), { mode: "remote", url: "https://spark.tail.ts.net", source: "env" });
		assert.deepEqual(resolveClientConnection({ env: {}, saved: { serverUrl: "https://other.example" } }), { mode: "remote", url: "https://other.example", source: "settings" });
		assert.deepEqual(resolveClientConnection({ env: {}, saved: {} }), { mode: "local", url: null, source: "default" });
		assert.equal(resolveClientConnection({ env: { LH_SERVER_URL: "notaurl" }, saved: {} }).mode, "local");
	});

	it("round-trips the saved URL and clears it", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "lh-client-"));
		const file = path.join(directory, "client-settings.json");
		try {
			writeClientSettings(file, "https://spark.tail.ts.net");
			assert.deepEqual(readClientSettings(file), { serverUrl: "https://spark.tail.ts.net" });
			writeClientSettings(file, null);
			assert.deepEqual(readClientSettings(file), {});
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("remote shell boot", () => {
	it("opens the remote origin and does not spawn a local server", async () => {
		const remote = "https://spark.example.ts.net";
		const loaded: string[] = [];
		let spawned = false;
		let options: { webPreferences?: { additionalArguments?: string[] } } | undefined;
		class FakeWindow {
			static getAllWindows() { return []; }
			constructor(value: typeof options) { options = value; }
			webContents = { on() {}, setWindowOpenHandler() {}, send() {} };
			loadURL(url: string) { loaded.push(url); }
			once() {}
			isDestroyed() { return false; }
		}
		const mainFile = new URL("../electron/main.cjs", import.meta.url);
		const mainRequire = createRequire(mainFile);
		const context = {
			require: (id: string) => {
				if (id === "electron") return {
					app: {
						setName() {}, getPath: () => "/fixture/LearnHarness", setPath() {}, requestSingleInstanceLock: () => false,
						quit() {}, exit() {}, on() {}, once() {}, removeListener() {}, whenReady: async () => {}, relaunch() {},
					},
					BrowserWindow: FakeWindow,
					nativeTheme: { themeSource: "system" },
					Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} },
					ipcMain: { handle() {}, on() {} },
					session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
					shell: { openExternal() {} },
					dialog: {},
				};
				if (id === "node:fs") return { mkdirSync() {}, appendFileSync() {}, existsSync: () => false, readFileSync };
				if (id === "node:child_process") return { spawn() { spawned = true; throw new Error("local server spawned"); } };
				return mainRequire(id);
			},
			process: { platform: "darwin", argv: [], env: { LH_SERVER_URL: remote }, on() {} },
			AbortController, URL, setImmediate, __dirname: path.dirname(fileURLToPath(mainFile)),
		};
		runInNewContext(readFileSync(mainFile, "utf8"), context, { filename: fileURLToPath(mainFile) });
		await runInNewContext("main()", context);
		assert.equal(spawned, false);
		assert.deepEqual(loaded, [remote]);
		assert.deepEqual(JSON.parse(JSON.stringify(options?.webPreferences?.additionalArguments)), ["--lh-web-subscriptions", "--lh-remote-server"]);
	});
});

function fileURLToPath(url: URL): string {
	return require("node:url").fileURLToPath(url);
}
