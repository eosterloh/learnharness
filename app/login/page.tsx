import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ServerLogin } from "@/components/server-login";
import { SESSION_COOKIE, ownerPasswordState, ownerSessionAuthorized, safeNextPath, serverMode } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
	const nextPath = safeNextPath((await searchParams).next);
	if (!serverMode()) redirect(nextPath);
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	if (token && ownerSessionAuthorized(new Request("http://localhost/login", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))) {
		redirect(nextPath);
	}
	const state = ownerPasswordState();
	return <ServerLogin needsSetup={state.needsSetup} error={state.error} nextPath={nextPath} />;
}
