import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialSidebarOpen, sidebarShown, sidebarViewport } from "../components/sidebar-layout.ts";

describe("phone sidebar", () => {
	it("covers a phone and keeps the Electron narrow window closed until it widens", () => {
		assert.equal(sidebarViewport(390, false), "phone");
		assert.equal(sidebarViewport(390, true), "phone");
		assert.equal(sidebarViewport(800, true), "electron-narrow");
		assert.equal(sidebarViewport(800, false), "wide");
		assert.equal(sidebarViewport(1200, true), "wide");
		assert.equal(sidebarShown(true, "phone"), "overlay");
		assert.equal(sidebarShown(false, "phone"), "closed");
		assert.equal(sidebarShown(true, "electron-narrow"), "closed");
		assert.equal(sidebarShown(true, "wide"), "inline");
		assert.equal(initialSidebarOpen(null, 390), false);
		assert.equal(initialSidebarOpen(null, 1200), true);
		assert.equal(initialSidebarOpen("1", 390), true);
	});
});
