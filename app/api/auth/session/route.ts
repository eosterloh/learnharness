import { NextResponse } from "next/server";
import { ownerPasswordState, ownerSessionAuthorized, serverMode } from "@/src/server";

export async function GET(request: Request) {
	const mode = serverMode();
	const state = ownerPasswordState();
	return NextResponse.json({
		serverMode: mode,
		needsSetup: mode && state.needsSetup,
		authenticated: mode ? ownerSessionAuthorized(request) : true,
		...(state.error ? { error: state.error } : {}),
	}, { headers: { "Cache-Control": "no-store" } });
}
