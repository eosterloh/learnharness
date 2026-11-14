import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
	authorizedBearer,
	isPublicAuthRequest,
	ownerSessionAuthorized,
	serverMode,
	syncOwnerPasswordFromEnv,
} from "./owner-auth.ts";

export { serverMode };

/** Browser-only mode: `next dev` / `next start` without the desktop shell's
 * per-launch secret. */
export function browserOnlyMode(env: Record<string, string | undefined> = process.env): boolean {
	return env.LH_DESKTOP_SERVER !== "1" && !env.LH_DESKTOP_API_SECRET;
}

/** Per-launch desktop HTTP capability. This is not an OS-user malware
 * boundary and is not an OAuth credential. Browser-only mode is checked by
 * browserAPIRefusal instead. */
export function desktopAPIAuthorized(
	headers: Headers,
	env: Record<string, string | undefined> = process.env,
): boolean {
	const expected = env.LH_DESKTOP_API_SECRET;
	if (serverMode(env)) return false;
	if (browserOnlyMode(env)) return true;
	if (!expected || expected.length < 64) return false;
	const supplied = headers.get("x-learnharness-desktop");
	if (!supplied) return false;
	const actual = Buffer.from(supplied);
	const wanted = Buffer.from(expected);
	return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

/** Same-origin browser controls, not user authentication. Web/dev deliberately
 * retains the existing shared-server/API-key trust model. Never trust forwarded
 * origins or add CORS grants here. A public deployment needs its own access gate. */
export function subscriptionRequestOrigin(request: Request): string | undefined {
	try {
		const url = new URL(request.url);
		const host = request.headers.get("host") ?? url.host;
		const addressed = new URL(`${url.protocol}//${host}`);
		if (!["http:", "https:"].includes(addressed.protocol) || addressed.username || addressed.password || addressed.pathname !== "/" || addressed.search || addressed.hash) return;
		return addressed.origin;
	} catch { return; }
}

/** DNS rebinding needs an attacker-owned DNS name, so localhost names and IP
 * literals are always safe. Any other name must be listed in LH_ALLOWED_HOSTS
 * (comma-separated, case-insensitive, port ignored). */
export function browserHostAllowed(host: string | null, env: Record<string, string | undefined> = process.env): boolean {
	if (!host) return false;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname.toLowerCase();
	} catch {
		return false;
	}
	if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
	if (isIP(hostname.replace(/^\[|\]$/g, "")) !== 0) return true;
	const allowed = (env.LH_ALLOWED_HOSTS ?? "").split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
	return allowed.includes(hostname);
}

/** Shared by Proxy and the streamed document route that deliberately bypasses
 * Proxy's truncated body clone. Check before any route-specific work. */
export function apiRequestRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	return apiRequestDecision(request, env)?.error;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostRefusal(request: Request, env: Record<string, string | undefined>): string | undefined {
	if (!browserHostAllowed(request.headers.get("host") ?? new URL(request.url).host, env)) {
		return "This host name is not allowed. Use localhost or an IP address, or add the name to LH_ALLOWED_HOSTS.";
	}
}

/** Writes without Origin or Sec-Fetch-Site come from non-browser clients
 * and are allowed. Reads are not a cross-site leak. */
function writeCrossSiteRefusal(request: Request): string | undefined {
	if (READ_METHODS.has(request.method.toUpperCase())) return;
	const site = request.headers.get("sec-fetch-site");
	const origin = request.headers.get("origin");
	if ((site !== null && site !== "same-origin") || (origin !== null && origin !== subscriptionRequestOrigin(request))) {
		return "Cross-site requests to the LearnHarness API are not allowed.";
	}
}

/** Browser-only API gate: a Host check against DNS rebinding and a
 * cross-site check on writes. Returns the refusal, if any. */
export function browserAPIRefusal(request: Request, env: Record<string, string | undefined> = process.env): string | undefined {
	return hostRefusal(request, env) ?? writeCrossSiteRefusal(request);
}

export type ApiRefusal = { error: string; status: number };

function serverAPIRefusal(request: Request, env: Record<string, string | undefined>): ApiRefusal | undefined {
	// Hash an env password at most once per unchanged file. Login still
	// verifies the submitted password on its own.
	syncOwnerPasswordFromEnv(env);
	const host = hostRefusal(request, env);
	if (host) return { error: host, status: 403 };
	let pathname = "/";
	try {
		pathname = new URL(request.url).pathname;
	} catch { /* treated as a protected path */ }
	if (isPublicAuthRequest(request.method, pathname)) {
		const crossSite = writeCrossSiteRefusal(request);
		return crossSite ? { error: crossSite, status: 403 } : undefined;
	}
	if (!ownerSessionAuthorized(request, env)) return { error: "Sign in required.", status: 401 };
	// A bearer credential is not attached by a browser navigation. Cookie
	// sessions still refuse cross-site writes.
	if (!authorizedBearer(request, env)) {
		const crossSite = writeCrossSiteRefusal(request);
		if (crossSite) return { error: crossSite, status: 403 };
	}
}

/** Shared by Proxy and the streamed document route. Status is 401 for a
 * missing server-mode session and 403 for the desktop and browser gates. */
export function apiRequestDecision(request: Request, env: Record<string, string | undefined> = process.env): ApiRefusal | undefined {
	if (serverMode(env)) return serverAPIRefusal(request, env);
	if (browserOnlyMode(env)) {
		const error = browserAPIRefusal(request, env);
		return error ? { error, status: 403 } : undefined;
	}
	if (!desktopAPIAuthorized(request.headers, env)) {
		return { error: "Desktop API access requires the trusted LearnHarness window.", status: 403 };
	}
}
