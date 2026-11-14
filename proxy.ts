import { NextResponse, type NextRequest } from "next/server";
import { apiRequestDecision } from "./src/server/desktop-access.ts";
import { ownerSessionAuthorized, safeNextPath, serverMode } from "./src/server/owner-auth.ts";

/** Protects API methods, including SSE and spending/settings routes. The one
 * streamed document route enforces the identical all-method request policy
 * inside its handler, avoiding Next's silently truncated Proxy body clone.
 * No public callback or worker bypass: legitimate self-HTTP still needs the capability.
 *
 * Page routes are matched so server mode can redirect before any chat HTML
 * is rendered. Desktop and browser-only modes pass those requests through. */
export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const api = pathname === "/api" || pathname.startsWith("/api/");
	if (!api) {
		if (!serverMode() || pathname === "/login" || ownerSessionAuthorized(request)) return NextResponse.next();
		const login = request.nextUrl.clone();
		login.pathname = "/login";
		login.search = "";
		const next = safeNextPath(pathname + request.nextUrl.search);
		if (next !== "/") login.searchParams.set("next", next);
		return NextResponse.redirect(login);
	}
	const refusal = apiRequestDecision(request);
	if (refusal) {
		return NextResponse.json(
			{ error: refusal.error },
			{ status: refusal.status, headers: { "Cache-Control": "no-store" } },
		);
	}
	return NextResponse.next();
}

export const config = {
	// Keep /api itself covered; exempt only the exact streamed endpoint, not
	// the documents subtree or other plugin routes. Page paths are separate
	// so that exemption stays intact. Must remain static literals.
	matcher: [
		"/api",
		"/api/((?!plugins/[^/]+/documents/markdown/?$).*)",
		// Document HTML only. A broad negative-lookahead also matches
		// non-routes such as /apix and would widen Proxy past the API list.
		"/",
		"/login",
		"/chat/:path*",
		"/plugins/:path*",
		"/settings",
	],
};
