"use client";

import { useState, type FormEvent } from "react";

/** The server-mode gate. The cookie is httpOnly; this form never stores the
 * bearer token the login response also returns for non-browser clients. */
export function ServerLogin({
	needsSetup,
	error,
	nextPath,
}: {
	needsSetup: boolean;
	error?: string;
	nextPath: string;
}) {
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState(error ?? "");
	const [pending, setPending] = useState(false);

	async function submit(event: FormEvent) {
		event.preventDefault();
		setPending(true);
		setMessage("");
		try {
			const res = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ password }),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setMessage(body.error ?? "Could not sign in.");
				setPending(false);
				return;
			}
			window.location.assign(nextPath);
		} catch {
			setMessage("Could not reach the server.");
			setPending(false);
		}
	}

	return (
		<main className="flex min-h-dvh items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			<form onSubmit={(event) => void submit(event)} className="w-full max-w-sm rounded-md border border-border bg-card p-6">
				<h1 className="font-title text-3xl tracking-tight">LearnHarness</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					{needsSetup ? "Choose a password for this server." : "Sign in to this server."}
				</p>
				<label className="mt-5 block text-xs uppercase tracking-wider text-muted-foreground" htmlFor="lh-server-password">
					Password
				</label>
				<input
					id="lh-server-password"
					name="password"
					type="password"
					required
					minLength={8}
					maxLength={200}
					autoFocus
					autoComplete={needsSetup ? "new-password" : "current-password"}
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					className="lh-input mt-2 w-full rounded-md border border-border bg-background px-3 py-2"
				/>
				{message && (
					<p role="alert" className="mt-3 text-sm text-error">
						{message}
					</p>
				)}
				<button
					type="submit"
					disabled={pending}
					className="mt-5 w-full rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50"
				>
					{needsSetup ? "Save password" : "Sign in"}
				</button>
			</form>
		</main>
	);
}
