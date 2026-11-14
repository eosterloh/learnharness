"use strict";

const fs = require("node:fs");

/** The desktop shell's choice of server. Local mode is the default.
 * LH_DEV_URL remains the external development server and wins over a
 * saved remote URL. LH_SERVER_URL wins over the saved setting. */
function parseServerUrl(value) {
	if (value == null || String(value).trim() === "") return { url: null };
	let url;
	try {
		url = new URL(String(value).trim());
	} catch {
		return { error: "Enter an http(s) URL." };
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Enter an http(s) URL." };
	if (url.username || url.password) return { error: "Put the password in the server login, not the URL." };
	if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { error: "Use the site root, without a path." };
	return { url: url.origin };
}

function resolveClientConnection({ env, saved }) {
	if (env.LH_DEV_URL) return { mode: "dev", url: env.LH_DEV_URL, source: "dev" };
	if (typeof env.LH_SERVER_URL === "string" && env.LH_SERVER_URL.trim()) {
		const parsed = parseServerUrl(env.LH_SERVER_URL);
		if (parsed.url) return { mode: "remote", url: parsed.url, source: "env" };
		return { mode: "local", url: null, source: "env", error: parsed.error };
	}
	if (saved && typeof saved.serverUrl === "string" && saved.serverUrl.trim()) {
		const parsed = parseServerUrl(saved.serverUrl);
		if (parsed.url) return { mode: "remote", url: parsed.url, source: "settings" };
	}
	return { mode: "local", url: null, source: "default" };
}

function readClientSettings(file) {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.serverUrl !== "string") return {};
		return { serverUrl: raw.serverUrl };
	} catch {
		return {};
	}
}

function writeClientSettings(file, serverUrl) {
	if (!serverUrl) {
		fs.rmSync(file, { force: true });
		return;
	}
	fs.mkdirSync(require("node:path").dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify({ serverUrl }, null, "\t")}\n`, { mode: 0o600 });
}

module.exports = { parseServerUrl, resolveClientConnection, readClientSettings, writeClientSettings };
