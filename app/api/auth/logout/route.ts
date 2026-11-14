import { NextResponse } from "next/server";
import { SESSION_COOKIE, logoutOwner, requestSessionToken, serverMode, sessionCookieOptions } from "@/src/server";

export async function POST(request: Request) {
	if (serverMode()) logoutOwner(requestSessionToken(request));
	const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
	response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(request), maxAge: 0 });
	return response;
}
