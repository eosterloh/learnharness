"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Connection = { mode: "local" | "remote" | "dev"; url: string | null; source: string; serverUrl: string };

declare global {
	interface Window {
		LearnHarnessAndroid?: { openServerSettings: () => void };
	}
}

/** Where this desktop or phone window gets its data. Absent in a plain browser. */
export function ClientConnectionSettings() {
	const [connection, setConnection] = useState<Connection | null>(null);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState("");
	const [android, setAndroid] = useState(false);

	useEffect(() => {
		const bridge = window.lh?.clientConnection;
		if (bridge) {
			void bridge.get().then((value) => {
				setConnection(value);
				setDraft(value.mode === "remote" ? value.url ?? "" : "");
			}).catch(() => setError("Could not read the desktop connection."));
		}
		if (window.LearnHarnessAndroid?.openServerSettings) setAndroid(true);
	}, []);

	if (!connection && !android) return null;
	const locked = connection?.source === "env" || connection?.mode === "dev";

	async function save(serverUrl: string | null) {
		setError("");
		try {
			const result = await window.lh?.clientConnection?.set(serverUrl);
			if (result?.error) setError(result.error);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not save the server.");
		}
	}

	return (
		<div className="flex flex-col gap-2" data-testid="client-connection">
			{connection && (
				<>
					<p className="text-xs text-muted-foreground">
						{connection.mode === "remote"
							? "This window uses a remote server. Sign in there. Conversations stay on that server."
							: connection.mode === "dev"
								? "This window follows the development server."
								: "This window runs its own server on this Mac."}
					</p>
					<Input
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						placeholder="https://spark.tail.ts.net"
						aria-label="Remote server URL"
						disabled={locked}
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
					/>
					<div className="flex flex-wrap gap-2">
						<Button type="button" size="sm" disabled={locked} onClick={() => void save(draft.trim() ? draft.trim() : null)}>
							Save and restart
						</Button>
						{connection.mode === "remote" && connection.source === "settings" && (
							<Button type="button" size="sm" variant="ghost" onClick={() => void save(null)}>
								Use this Mac
							</Button>
						)}
					</div>
				</>
			)}
			{android && (
				<Button type="button" size="sm" variant="ghost" onClick={() => window.LearnHarnessAndroid?.openServerSettings()}>
					Change phone server
				</Button>
			)}
			{error && <p role="alert" className="text-xs text-error">{error}</p>}
		</div>
	);
}
