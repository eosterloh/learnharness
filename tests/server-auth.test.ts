/**
 * Headless server mode: /api requires a password session, including SSE.
 * The desktop capability and the localhost browser gate stay as they were.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST as login } from "../app/api/auth/login/route.ts";
import { POST as logout } from "../app/api/auth/logout/route.ts";
import { GET as session } from "../app/api/auth/session/route.ts";
import { POST as setup } from "../app/api/auth/setup/route.ts";
import { proxy } from "../proxy.ts";
import { createPluginDocumentRoute } from "../src/server/plugin-transport.ts";
import { desktopAPIAuthorized } from "../src/server/desktop-access.ts";
import {
	loginOwner,
	ownerAuthPaths,
	resetOwnerAuthForTests,
	safeNextPath,
	serverMode,
} from "../src/server/owner-auth.ts";

const secret = "b".repeat(64);
const directory = mkdtempSync(path.join(tmpdir(), "lh-server-auth-"));
const authFile = path.join(directory, "auth.json");
const password = "correct-horse";

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
	const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await run();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const serverEnv = {
	LH_SERVER_MODE: "1",
	LH_DESKTOP_SERVER: undefined,
	LH_DESKTOP_API_SECRET: undefined,
	LH_AUTH_FILE: authFile,
	LH_OWNER_PASSWORD: undefined,
	LH_ALLOWED_HOSTS: undefined,
	LH_COOKIE_SECURE: undefined,
};

function server<T>(run: () => Promise<T>): Promise<T> {
	return withEnv(serverEnv, run);
}

function jsonRequest(pathname: string, body: unknown, headers: Record<string, string> = {}) {
	return new Request(`http://127.0.0.1:3000${pathname}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

function cookieHeader(response: Response): string {
	const raw = response.headers.get("set-cookie") ?? "";
	const pair = raw.split(";")[0]?.trim() ?? "";
	assert.ok(pair.startsWith("lh_session="), raw);
	return pair;
}

describe("server-mode auth", () => {
	beforeEach(() => {
		resetOwnerAuthForTests();
		rmSync(directory, { recursive: true, force: true });
		mkdirSync(directory, { recursive: true });
	});

	after(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("rejects unauthenticated API reads, writes, and SSE until a session or bearer is presented", async () => {
		await server(async () => {
			const created = await setup(jsonRequest("/api/auth/setup", { password }));
			assert.equal(created.status, 200);
			const setCookie = created.headers.get("set-cookie") ?? "";
			assert.match(setCookie, /HttpOnly/i);
			assert.match(setCookie, /Secure/i);
			assert.match(setCookie, /SameSite=Lax/i);
			assert.equal(statSync(ownerAuthPaths().passwordFile).mode & 0o777, 0o600);
			const token = (await created.clone().json()).token as string;
			assert.equal(typeof token, "string");
			for (const pathname of ["/api/settings", "/api/events", "/api/chats/lesson/stream", "/api/chat"]) {
				assert.equal(proxy(new NextRequest(`http://127.0.0.1:3000${pathname}`)).status, 401, pathname);
				assert.equal((await proxy(new NextRequest(`http://127.0.0.1:3000${pathname}`)).json()).error, "Sign in required.");
			}
			const cookie = cookieHeader(created);
			const cases: Record<string, string>[] = [{ cookie }, { authorization: `Bearer ${token}` }];
			for (const headers of cases) {
				for (const pathname of ["/api/events", "/api/chats/lesson/stream", "/api/settings"]) {
					const allowed = proxy(new NextRequest(`http://127.0.0.1:3000${pathname}`, { headers }));
					assert.equal(allowed.headers.get("x-middleware-next"), "1", `${pathname} ${JSON.stringify(headers)}`);
				}
			}
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/api/settings", { headers: { authorization: "Bearer wrong" } })).status, 401);
		});
	});

	it("redirects page loads before render and leaves the login page itself available", async () => {
		await server(async () => {
			const page = proxy(new NextRequest("http://127.0.0.1:3000/chat/lesson?prompt=hi"));
			assert.equal(page.status, 307);
			const location = new URL(page.headers.get("location") ?? "");
			assert.equal(location.pathname, "/login");
			assert.equal(location.searchParams.get("next"), "/chat/lesson?prompt=hi");
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/login")).headers.get("x-middleware-next"), "1");
			assert.equal(safeNextPath("//evil.example"), "/");
			assert.equal(safeNextPath("https://evil.example"), "/");
			assert.equal(safeNextPath("/login?next=/"), "/");
			const created = await setup(jsonRequest("/api/auth/setup", { password }));
			const home = proxy(new NextRequest("http://127.0.0.1:3000/", { headers: { cookie: cookieHeader(created) } }));
			assert.equal(home.headers.get("x-middleware-next"), "1");
		});
	});

	it("accepts the env password, rejects a wrong one, and revokes on logout", async () => {
		await server(async () => {
			process.env.LH_OWNER_PASSWORD = password;
			const state = await session(new Request("http://127.0.0.1:3000/api/auth/session"));
			assert.deepEqual(await state.json(), { serverMode: true, needsSetup: false, authenticated: false });
			assert.equal((await setup(jsonRequest("/api/auth/setup", { password: "another-password" }))).status, 409);
			assert.equal((await login(jsonRequest("/api/auth/login", { password: "not-the-password" }))).status, 401);
			const signed = await login(jsonRequest("/api/auth/login", { password }));
			assert.equal(signed.status, 200);
			const cookie = cookieHeader(signed);
			const viewed = await session(new Request("http://127.0.0.1:3000/api/auth/session", { headers: { cookie } }));
			assert.equal(viewed.status, 200);
			assert.equal((await viewed.json() as { authenticated: boolean }).authenticated, true);
			const ended = await logout(new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST", headers: { cookie } }));
			assert.match(ended.headers.get("set-cookie") ?? "", /Max-Age=0/i);
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/api/settings", { headers: { cookie } })).status, 401);
		});
	});

	it("keeps a cross-site cookie write out and still allows a bearer client", async () => {
		await server(async () => {
			const created = await setup(jsonRequest("/api/auth/setup", { password }));
			const cookie = cookieHeader(created);
			const token = (await created.clone().json()).token as string;
			const cross = proxy(new NextRequest("http://127.0.0.1:3000/api/chats", {
				method: "POST",
				headers: { cookie, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
			}));
			assert.equal(cross.status, 403);
			const bearer = proxy(new NextRequest("http://127.0.0.1:3000/api/chats", {
				method: "POST",
				headers: { authorization: `Bearer ${token}` },
			}));
			assert.equal(bearer.headers.get("x-middleware-next"), "1");
			const streamed = createPluginDocumentRoute({ convertDocument: async () => Response.json({ markdown: "no" }) });
			const denied = await streamed.POST(new Request("http://127.0.0.1:3000/api/plugins/example/documents/markdown", { method: "POST" }), { params: Promise.resolve({ id: "example" }) });
			assert.equal(denied.status, 401);
			const allowed = await streamed.POST(new Request("http://127.0.0.1:3000/api/plugins/example/documents/markdown", { method: "POST", headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: "example" }) });
			assert.equal(allowed.status, 200);
		});
	});

	it("locks briefly after repeated failures and can be a plain-HTTP cookie when asked", async () => {
		await server(async () => {
			process.env.LH_OWNER_PASSWORD = password;
			process.env.LH_COOKIE_SECURE = "0";
			const now = 1_000_000;
			for (let i = 0; i < 8; i++) assert.equal((loginOwner("wrong-password", process.env, now) as { status?: number }).status, 401);
			assert.equal((loginOwner(password, process.env, now) as { status?: number }).status, 429);
			assert.equal(loginOwner(password, process.env, now + 5_000).ok, true);
			const signed = await login(jsonRequest("/api/auth/login", { password }));
			assert.doesNotMatch(signed.headers.get("set-cookie") ?? "", /Secure/i);
			assert.match(signed.headers.get("set-cookie") ?? "", /HttpOnly/i);
		});
	});

	it("leaves desktop Electron and browser-only mode unchanged", async () => {
		assert.equal(serverMode({}), false);
		assert.equal(serverMode({ LH_SERVER_MODE: "1", LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: secret }), false);
		assert.equal(desktopAPIAuthorized(new Headers(), {}), true);
		await withEnv({ LH_SERVER_MODE: "1", LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: secret, LH_AUTH_FILE: authFile }, () => {
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/api/settings")).status, 403);
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/api/settings", { headers: { "x-learnharness-desktop": secret } })).headers.get("x-middleware-next"), "1");
			assert.equal(proxy(new NextRequest("http://mymac.local:4747/chat/new", { headers: { "x-learnharness-desktop": secret } })).headers.get("x-middleware-next"), "1");
		});
		await withEnv({ LH_SERVER_MODE: undefined, LH_DESKTOP_SERVER: undefined, LH_DESKTOP_API_SECRET: undefined, LH_ALLOWED_HOSTS: undefined }, () => {
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/api/settings")).headers.get("x-middleware-next"), "1");
			assert.equal(proxy(new NextRequest("http://127.0.0.1:3000/chat/new")).headers.get("x-middleware-next"), "1");
			assert.equal(serverMode(), false);
		});
	});
});
