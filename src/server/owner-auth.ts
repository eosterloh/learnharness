/**
 * Single-owner sign-in for a headless server (`LH_SERVER_MODE=1`).
 *
 * The desktop shell keeps its per-launch capability. This module is the
 * other gate: a scrypt password hash beside `LH_AUTH_FILE`, and sessions
 * presented as an httpOnly cookie or a bearer token. One process, one
 * owner. Not a multi-user account system.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../store/atomic-write.ts";

export const SESSION_COOKIE = "lh_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
const SESSION_LIMIT = 20;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const SCRYPT = { n: 16384, r: 8, p: 1, keyLen: 32 } as const;
const THROTTLE_AFTER = 8;
const THROTTLE_MS = 5_000;

type Env = Record<string, string | undefined>;

type PasswordRecord = {
	version: 1;
	n: number;
	r: number;
	p: number;
	keyLen: number;
	salt: string;
	hash: string;
};

type SessionRecord = { hash: string; expiresAt: number };

export type OwnerPasswordState = { needsSetup: boolean; error?: string };

export type OwnerLoginResult =
	| { ok: true; token: string }
	| { ok: false; status: number; error: string; needsSetup?: boolean; retryAfter?: number };

/** Headless server auth. A desktop secret wins, so a packaged Electron
 * child never picks up server mode from an inherited environment. */
export function serverMode(env: Env = process.env): boolean {
	return env.LH_SERVER_MODE === "1" && env.LH_DESKTOP_SERVER !== "1" && !env.LH_DESKTOP_API_SECRET;
}

export function ownerAuthPaths(env: Env = process.env): { passwordFile: string; sessionsFile: string } {
	const authFile = env.LH_AUTH_FILE ? path.resolve(env.LH_AUTH_FILE) : path.resolve("auth.json");
	const directory = path.dirname(authFile);
	return {
		passwordFile: path.join(directory, "owner-password.json"),
		sessionsFile: path.join(directory, "owner-sessions.json"),
	};
}

/** Relative in-app path only. Rejects scheme-relative and backslash forms. */
export function safeNextPath(value: string | null | undefined): string {
	if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("://")) return "/";
	if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return "/";
	return value;
}

let syncedKey = "";
let failedLogins = 0;
let blockedUntil = 0;

/** Test isolation. Production never needs to drop the in-memory throttle. */
export function resetOwnerAuthForTests(): void {
	syncedKey = "";
	failedLogins = 0;
	blockedUntil = 0;
}

function passwordError(password: string): string | undefined {
	if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || password.includes("\0")) {
		return `Use a password between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`;
	}
}

function readJson(file: string): unknown | "missing" | "corrupt" {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt";
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return "corrupt";
	}
}

function passwordRecord(value: unknown): PasswordRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const record = value as Partial<PasswordRecord>;
	if (record.version !== 1 || record.n !== SCRYPT.n || record.r !== SCRYPT.r || record.p !== SCRYPT.p || record.keyLen !== SCRYPT.keyLen) return;
	if (typeof record.salt !== "string" || typeof record.hash !== "string" || !record.salt || !record.hash) return;
	return record as PasswordRecord;
}

function readPassword(env: Env): PasswordRecord | "missing" | "corrupt" {
	const parsed = readJson(ownerAuthPaths(env).passwordFile);
	if (parsed === "missing" || parsed === "corrupt") return parsed;
	return passwordRecord(parsed) ?? "corrupt";
}

function writeSecret(file: string, text: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, text, { mode: 0o600 });
}

function writePassword(env: Env, password: string): void {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.n, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
	const record: PasswordRecord = {
		version: 1,
		n: SCRYPT.n,
		r: SCRYPT.r,
		p: SCRYPT.p,
		keyLen: SCRYPT.keyLen,
		salt: salt.toString("base64"),
		hash: hash.toString("base64"),
	};
	writeSecret(ownerAuthPaths(env).passwordFile, `${JSON.stringify(record, null, "\t")}\n`);
}

function verifyPassword(password: string, record: PasswordRecord): boolean {
	const actual = scryptSync(password, Buffer.from(record.salt, "base64"), record.keyLen, {
		N: record.n, r: record.r, p: record.p, maxmem: 64 * 1024 * 1024,
	});
	const expected = Buffer.from(record.hash, "base64");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** When `LH_OWNER_PASSWORD` is set it is the source of truth. The hash file
 * is what later boots use, so the variable can be removed after the first
 * successful start. A changed variable rewrites the hash. */
export function syncOwnerPasswordFromEnv(env: Env = process.env): void {
	const password = env.LH_OWNER_PASSWORD ?? "";
	if (!password || passwordError(password)) return;
	const file = ownerAuthPaths(env).passwordFile;
	let mtime = 0;
	try {
		mtime = fs.statSync(file).mtimeMs;
	} catch {
		mtime = 0;
	}
	const key = `${file}\0${password}\0${mtime}`;
	if (mtime !== 0 && syncedKey === key) return;
	const current = readPassword(env);
	if (current !== "missing" && current !== "corrupt" && verifyPassword(password, current)) {
		syncedKey = key;
		return;
	}
	writePassword(env, password);
	let written = 0;
	try {
		written = fs.statSync(file).mtimeMs;
	} catch {
		written = 0;
	}
	syncedKey = `${file}\0${password}\0${written}`;
}

export function ownerPasswordState(env: Env = process.env): OwnerPasswordState {
	if (!serverMode(env)) return { needsSetup: false };
	if ((env.LH_OWNER_PASSWORD ?? "") && passwordError(env.LH_OWNER_PASSWORD ?? "")) {
		return { needsSetup: false, error: `LH_OWNER_PASSWORD must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.` };
	}
	syncOwnerPasswordFromEnv(env);
	const record = readPassword(env);
	if (record === "corrupt") {
		return {
			needsSetup: false,
			error: "Password storage is unreadable. Set LH_OWNER_PASSWORD to replace it, or delete owner-password.json and choose a new password.",
		};
	}
	return { needsSetup: record === "missing" };
}

function readSessions(env: Env, now: number): SessionRecord[] {
	const parsed = readJson(ownerAuthPaths(env).sessionsFile);
	if (parsed === "missing" || parsed === "corrupt" || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	const sessions = (parsed as { sessions?: unknown }).sessions;
	if (!Array.isArray(sessions)) return [];
	return sessions.flatMap((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
		const hash = (entry as { hash?: unknown }).hash;
		const expiresAt = (entry as { expiresAt?: unknown }).expiresAt;
		if (typeof hash !== "string" || !hash || typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= now) return [];
		return [{ hash, expiresAt }];
	});
}

function writeSessions(env: Env, sessions: SessionRecord[]): void {
	writeSecret(ownerAuthPaths(env).sessionsFile, `${JSON.stringify({ version: 1, sessions }, null, "\t")}\n`);
}

function tokenHash(token: string): string {
	return createHash("sha256").update(token).digest("base64url");
}

function hashesEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionTokenValid(token: string, env: Env = process.env, now = Date.now()): boolean {
	if (!token || token.length > 512) return false;
	const hash = tokenHash(token);
	return readSessions(env, now).some((session) => hashesEqual(session.hash, hash));
}

function issueSession(env: Env, now: number): string {
	const token = randomBytes(32).toString("base64url");
	const sessions = readSessions(env, now);
	sessions.push({ hash: tokenHash(token), expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000 });
	writeSessions(env, sessions.slice(-SESSION_LIMIT));
	return token;
}

function throttle(now: number): OwnerLoginResult | undefined {
	if (now < blockedUntil) {
		return {
			ok: false,
			status: 429,
			error: "Too many sign-in attempts. Wait and try again.",
			retryAfter: Math.max(1, Math.ceil((blockedUntil - now) / 1000)),
		};
	}
}

function noteFailure(now: number): void {
	failedLogins += 1;
	if (failedLogins >= THROTTLE_AFTER) {
		blockedUntil = now + THROTTLE_MS;
		failedLogins = 0;
	}
}

export function setupOwnerPassword(password: string, env: Env = process.env, now = Date.now()): OwnerLoginResult {
	const blocked = throttle(now);
	if (blocked) return blocked;
	const state = ownerPasswordState(env);
	if (state.error) return { ok: false, status: 500, error: state.error };
	if (!state.needsSetup) return { ok: false, status: 409, error: "A password is already set." };
	const problem = passwordError(password);
	if (problem) return { ok: false, status: 400, error: problem };
	writePassword(env, password);
	syncedKey = "";
	failedLogins = 0;
	return { ok: true, token: issueSession(env, now) };
}

export function loginOwner(password: string, env: Env = process.env, now = Date.now()): OwnerLoginResult {
	const blocked = throttle(now);
	if (blocked) return blocked;
	const state = ownerPasswordState(env);
	if (state.error) return { ok: false, status: 500, error: state.error };
	if (state.needsSetup) return { ok: false, status: 409, error: "Choose a password before signing in.", needsSetup: true };
	const record = readPassword(env);
	if (record === "missing" || record === "corrupt" || passwordError(password) || !verifyPassword(password, record)) {
		noteFailure(now);
		return { ok: false, status: 401, error: "Wrong password." };
	}
	failedLogins = 0;
	blockedUntil = 0;
	return { ok: true, token: issueSession(env, now) };
}

export function logoutOwner(token: string | undefined, env: Env = process.env, now = Date.now()): void {
	if (!token) return;
	const hash = tokenHash(token);
	const sessions = readSessions(env, now).filter((session) => !hashesEqual(session.hash, hash));
	writeSessions(env, sessions);
}

export function bearerToken(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	if (!header) return;
	const match = /^Bearer\s+(\S+)$/i.exec(header);
	const token = match?.[1];
	if (!token || token.length > 512) return;
	return token;
}

export function cookieToken(request: Request, name = SESSION_COOKIE): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() !== name) continue;
		const value = part.slice(eq + 1).trim();
		if (!value) return;
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
}

export function requestSessionToken(request: Request): string | undefined {
	return bearerToken(request) ?? cookieToken(request);
}

export function authorizedBearer(request: Request, env: Env = process.env): boolean {
	const token = bearerToken(request);
	return !!token && sessionTokenValid(token, env);
}

export function ownerSessionAuthorized(request: Request, env: Env = process.env): boolean {
	if (authorizedBearer(request, env)) return true;
	const cookie = cookieToken(request);
	return !!cookie && sessionTokenValid(cookie, env);
}

/** Secure by default in server mode. Tailscale Serve is HTTPS in the
 * browser even when the process sees plain HTTP from the local proxy.
 * `LH_COOKIE_SECURE=0` is the plain-HTTP lab switch. */
export function sessionCookieSecure(request: Request, env: Env = process.env): boolean {
	if (env.LH_COOKIE_SECURE === "0") return false;
	if (env.LH_COOKIE_SECURE === "1") return true;
	const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
	if (forwarded === "https") return true;
	try {
		if (new URL(request.url).protocol === "https:") return true;
	} catch { /* request URL is not a URL */ }
	return serverMode(env);
}

export function sessionCookieOptions(request: Request, env: Env = process.env): {
	httpOnly: true;
	sameSite: "lax";
	secure: boolean;
	path: "/";
	maxAge: number;
} {
	return {
		httpOnly: true,
		sameSite: "lax",
		secure: sessionCookieSecure(request, env),
		path: "/",
		maxAge: SESSION_MAX_AGE_SECONDS,
	};
}

export function isPublicAuthRequest(method: string, pathname: string): boolean {
	const verb = method.toUpperCase();
	if (pathname === "/api/auth/session" && (verb === "GET" || verb === "HEAD")) return true;
	if (pathname === "/api/auth/login" && verb === "POST") return true;
	if (pathname === "/api/auth/setup" && verb === "POST") return true;
	if (pathname === "/api/auth/logout" && verb === "POST") return true;
	return false;
}
