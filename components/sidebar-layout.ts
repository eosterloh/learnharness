/** Phone and desktop sidebar presentation.
 * SIDEBAR_AUTOCLOSE matches electron/main.cjs. Below a phone width the
 * sidebar covers the page instead of squeezing it, on every host. */
export const PHONE_WIDTH = 640;
export const SIDEBAR_AUTOCLOSE = 928;

export type SidebarViewport = "phone" | "electron-narrow" | "wide";
export type SidebarPresentation = "inline" | "overlay" | "closed";

export function sidebarViewport(width: number, electron: boolean): SidebarViewport {
	if (width < PHONE_WIDTH) return "phone";
	if (electron && width < SIDEBAR_AUTOCLOSE) return "electron-narrow";
	return "wide";
}

export function sidebarShown(preferredOpen: boolean, viewport: SidebarViewport): SidebarPresentation {
	if (!preferredOpen) return "closed";
	if (viewport === "phone") return "overlay";
	if (viewport === "electron-narrow") return "closed";
	return "inline";
}

/** First visit on a phone starts closed so the lesson is visible. */
export function initialSidebarOpen(stored: string | null, width: number): boolean {
	if (stored === null) return width >= PHONE_WIDTH;
	return stored === "1";
}
