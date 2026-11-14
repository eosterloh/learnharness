import { NextResponse } from "next/server";
import { SESSION_COOKIE, loginOwner, serverMode, sessionCookieOptions } from "@/src/server";

function passwordFrom(body: unknown): string {
	if (!body || typeof body !== "object" || Array.isArray(body)) return "";
	const password = (body as { password?: unknown }).password;
	return typeof password === "string" ? password : "";
}

export async function POST(request: Request) {
	if (!serverMode()) {
		return NextResponse.json({ error: "Server sign-in is not enabled." }, { status: 404, headers: { "Cache-Control": "no-store" } });
	}
	let body: unknown = null;
	try {
		body = await request.json();
	} catch {
		body = null;
	}
	const result = loginOwner(passwordFrom(body));
	if (!result.ok) {
		const headers: Record<string, string> = { "Cache-Control": "no-store" };
		if (result.retryAfter) headers["Retry-After"] = String(result.retryAfter);
		return NextResponse.json(
			{ error: result.error, ...(result.needsSetup ? { needsSetup: true } : {}) },
			{ status: result.status, headers },
		);
	}
	const response = NextResponse.json({ ok: true, token: result.token }, { headers: { "Cache-Control": "no-store" } });
	response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(request));
	return response;
}
