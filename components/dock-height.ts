"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { PHONE_WIDTH } from "@/components/sidebar-layout";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface DockHeightMeasurements {
	columnHeight: number;
	/** Stats/toolbar and block padding, outside the scrolling viewport. */
	outsideHeight: number;
	/** Everything in the viewport except the animated shell. */
	beforeShellHeight: number;
	shellBorderHeight: number;
	/** Natural content height, not the shell's animated/clamped height. */
	contentHeight: number;
	/** Null when collapsed, in chat mode, or showing malformed input. */
	questionHeight: number | null;
	questionPaddingHeight: number;
	/** Max height of the dock block on a phone. Absent on desktop. */
	viewportCap?: number | null;
}

/** Default phone sheet height. A drag can move it within the min and max. */
export const PHONE_DOCK_BLOCK_FRACTION = 0.58;
/** Short enough to keep the handle, the start of the question, and Submit. */
export const PHONE_DOCK_MIN_FRACTION = 0.34;
/** Tallest sheet that still leaves the session header and a transcript band. */
export const PHONE_DOCK_MAX_FRACTION = 0.82;
/** Column pixels kept above the sheet at its tallest, under the header. */
export const PHONE_DOCK_TRANSCRIPT_RESERVE = 96;
export const PHONE_DOCK_STORAGE_KEY = "lh.phoneDockFraction";

export function clampPhoneDockFraction(value: number): number {
	if (!Number.isFinite(value)) return PHONE_DOCK_BLOCK_FRACTION;
	return Math.min(PHONE_DOCK_MAX_FRACTION, Math.max(PHONE_DOCK_MIN_FRACTION, value));
}

/** Column and viewport clamps, so a stored fraction cannot cover the header. */
export function clampPhoneDockFractionToViewport(fraction: number, dynamicViewportHeight: number, columnHeight: number): number {
	const clamped = clampPhoneDockFraction(fraction);
	if (!(dynamicViewportHeight > 0) || !(columnHeight > 0)) return clamped;
	const maxByColumn = (columnHeight - PHONE_DOCK_TRANSCRIPT_RESERVE) / dynamicViewportHeight;
	const max = Math.min(PHONE_DOCK_MAX_FRACTION, Math.max(maxByColumn, PHONE_DOCK_MIN_FRACTION));
	return Math.min(max, Math.max(PHONE_DOCK_MIN_FRACTION, clamped));
}

export function readPhoneDockFraction(stored: string | null): number {
	if (stored == null || stored.trim() === "") return PHONE_DOCK_BLOCK_FRACTION;
	return clampPhoneDockFraction(Number(stored));
}

export function dockFractionFromDrag(startFraction: number, deltaY: number, dynamicViewportHeight: number): number {
	if (!(dynamicViewportHeight > 0)) return clampPhoneDockFraction(startFraction);
	// Dragging up (negative deltaY) grows the sheet.
	return clampPhoneDockFraction(startFraction - deltaY / dynamicViewportHeight);
}

let phoneDockFraction: number | null = null;

function storedPhoneDockFraction(): number {
	try {
		return readPhoneDockFraction(window.localStorage?.getItem(PHONE_DOCK_STORAGE_KEY) ?? null);
	} catch {
		return PHONE_DOCK_BLOCK_FRACTION;
	}
}

export function getPhoneDockFraction(): number {
	if (phoneDockFraction == null) phoneDockFraction = storedPhoneDockFraction();
	return phoneDockFraction;
}

export function setPhoneDockFraction(value: number, persist = true): number {
	phoneDockFraction = clampPhoneDockFraction(value);
	if (persist) {
		try { window.localStorage?.setItem(PHONE_DOCK_STORAGE_KEY, String(phoneDockFraction)); }
		catch { /* private mode and tests without storage */ }
	}
	return phoneDockFraction;
}

export function phoneDockBlockCap(columnWidth: number, dynamicViewportHeight: number, fraction = getPhoneDockFraction()): number | null {
	if (!(columnWidth > 0) || columnWidth >= PHONE_WIDTH) return null;
	if (!(dynamicViewportHeight > 0)) return null;
	return dynamicViewportHeight * clampPhoneDockFraction(fraction);
}

function dynamicViewportHeight(): number {
	const layout = window.innerHeight;
	const visual = window.visualViewport?.height ?? 0;
	if (visual > 0 && layout > 0) return Math.min(visual, layout);
	return visual > 0 ? visual : layout;
}

export function dockHeightBudget(m: DockHeightMeasurements) {
	const available = Math.max(m.columnHeight - 32, 0);
	const uncappedViewport = Math.max(available - m.outsideHeight, 0);
	const phoneViewport = m.viewportCap == null ? null : Math.max(m.viewportCap - m.outsideHeight, 0);
	const transcriptViewport = Math.max(m.columnHeight - PHONE_DOCK_TRANSCRIPT_RESERVE - m.outsideHeight, 0);
	const viewportMaxHeight = phoneViewport == null
		? uncappedViewport
		: Math.min(uncappedViewport, phoneViewport, transcriptViewport);
	const shellMaxHeight = Math.max(viewportMaxHeight - m.beforeShellHeight, 0);
	const naturalHeight = m.beforeShellHeight + m.shellBorderHeight + m.contentHeight;
	const questionMaxHeight = m.questionHeight === null
		? null
		: Math.max(viewportMaxHeight - (naturalHeight - m.questionHeight), 0);
	// A cap smaller than the question's padding leaves no content viewport.
	// Deliberately uncap the question and scroll the whole content instead;
	// do not confuse a measured zero with an unmeasured CSS fallback.
	const scrollWholeContent = questionMaxHeight === null
		? naturalHeight > viewportMaxHeight
		: questionMaxHeight <= m.questionPaddingHeight;
	return { viewportMaxHeight, shellMaxHeight, questionMaxHeight, scrollWholeContent };
}

interface DockHeightElements {
	column: HTMLElement;
	block: HTMLElement;
	viewport: HTMLElement;
	body: HTMLElement;
	shell: HTMLElement;
	content: HTMLElement;
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

/** Read natural geometry before writing any constraints. Cancel the shell's
 * animated height out of both ancestor measurements, then substitute its
 * natural content and borders. This stays valid during a WAAPI height morph
 * and when the outer viewport is already capped. */
export function syncDockHeight(elements: DockHeightElements, expanded: boolean) {
	const { column, block, viewport, body, shell, content } = elements;
	// QuestionDock keeps a laid-out form in an invisible h-0 wrapper;
	// PracticeDock removes its form. Neither hidden form is a height input.
	const question = expanded ? content.querySelector<HTMLElement>("[data-dock-scroll-area]") : null;
	const height = (el: HTMLElement) => el.getBoundingClientRect().height;
	const shellStyle = getComputedStyle(shell);
	const questionStyle = question ? getComputedStyle(question) : null;
	const budget = dockHeightBudget({
		columnHeight: column.clientHeight,
		outsideHeight: Math.max(height(block) - height(viewport), 0),
		beforeShellHeight: Math.max(height(body) - height(shell), 0),
		shellBorderHeight: pixels(shellStyle.borderTopWidth) + pixels(shellStyle.borderBottomWidth),
		contentHeight: height(content),
		questionHeight: question ? height(question) : null,
		questionPaddingHeight: questionStyle
			? pixels(questionStyle.paddingTop) + pixels(questionStyle.paddingBottom)
			: 0,
		viewportCap: phoneDockBlockCap(column.clientWidth, dynamicViewportHeight()),
	});
	const px = (value: number) => `${Math.round(value)}px`;
	if (budget.questionMaxHeight === null) block.style.removeProperty("--dock-max-h");
	else block.style.setProperty("--dock-max-h", budget.scrollWholeContent ? "none" : px(budget.questionMaxHeight));
	viewport.style.maxHeight = px(budget.viewportMaxHeight);
	// Overflow is visible in normal layouts: keep the shell's shadow intact.
	// The stats/model toolbar is a sibling, never inside this overflow box.
	viewport.style.overflowY = budget.scrollWholeContent ? "auto" : "visible";
	// Clamp animated starting heights too, so a previous tall variant cannot
	// paint above the column while morphing into a constrained layout.
	shell.style.maxHeight = budget.scrollWholeContent ? "none" : px(budget.shellMaxHeight);
	return budget;
}

interface DockHeightRefs {
	scrollRef: RefObject<HTMLElement | null>;
	blockRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
	bodyRef: RefObject<HTMLDivElement | null>;
	shellRef: RefObject<HTMLDivElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
}

let sheetApply: (() => void) | null = null;
let sheetDragging = false;
let sheetViewport = { height: 0, columnHeight: 0, columnWidth: 0 };

/** Grab-handle drag. Pointer capture plus a non-passive touchmove keep the
 * gesture off the transcript and off pull-to-refresh. One frame applies the
 * height; storage is written when the finger lifts. */
export function bindDockSheetHandle(handle: HTMLElement): () => void {
	let startY = 0;
	let startFraction = 0;
	let dragging = false;
	let frame = 0;
	const schedule = () => {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			sheetApply?.();
		});
	};
	const finish = () => {
		if (!dragging) return;
		dragging = false;
		sheetDragging = false;
		if (frame) globalThis.cancelAnimationFrame?.(frame);
		frame = 0;
		const next = clampPhoneDockFractionToViewport(getPhoneDockFraction(), sheetViewport.height, sheetViewport.columnHeight);
		setPhoneDockFraction(next, true);
		sheetApply?.();
	};
	const onPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || sheetViewport.columnWidth >= PHONE_WIDTH) return;
		if (!(sheetViewport.height > 0)) sheetViewport.height = dynamicViewportHeight();
		if (!(sheetViewport.columnHeight > 0)) sheetViewport.columnHeight = sheetViewport.height;
		dragging = true;
		sheetDragging = true;
		startY = event.clientY;
		startFraction = getPhoneDockFraction();
		handle.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	};
	const onPointerMove = (event: PointerEvent) => {
		if (!dragging) return;
		event.preventDefault();
		const next = clampPhoneDockFractionToViewport(
			dockFractionFromDrag(startFraction, event.clientY - startY, sheetViewport.height),
			sheetViewport.height,
			sheetViewport.columnHeight,
		);
		setPhoneDockFraction(next, false);
		schedule();
	};
	const onTouchMove = (event: TouchEvent) => {
		if (!dragging) return;
		event.preventDefault();
	};
	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("pointermove", onPointerMove);
	handle.addEventListener("pointerup", finish);
	handle.addEventListener("pointercancel", finish);
	handle.addEventListener("touchmove", onTouchMove, { passive: false });
	return () => {
		finish();
		handle.removeEventListener("pointerdown", onPointerDown);
		handle.removeEventListener("pointermove", onPointerMove);
		handle.removeEventListener("pointerup", finish);
		handle.removeEventListener("pointercancel", finish);
		handle.removeEventListener("touchmove", onTouchMove);
	};
}

export function useDockHeight({
	scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef,
	expanded, enabled, mode, onScrollbarInset, onHeight, onLayout,
}: DockHeightRefs & {
	expanded: boolean;
	enabled: boolean;
	/** Reconnect observers when the keyed content node/scroll area changes. */
	mode: string;
	onScrollbarInset: (inset: number) => void;
	/** Settled visible block height, fed through the existing reserve policy. */
	onHeight: (height: number) => void;
	/** Constraints are applied before notifying an active opening morph. */
	onLayout?: () => void;
}) {
	const measure = useCallback(() => {
		const column = scrollRef.current;
		const block = blockRef.current;
		const viewport = viewportRef.current;
		const body = bodyRef.current;
		const shell = shellRef.current;
		const content = contentRef.current;
		if (!column || !block || !viewport || !body || !shell || !content) return;
		sheetViewport = { height: dynamicViewportHeight(), columnHeight: column.clientHeight, columnWidth: column.clientWidth };
		onScrollbarInset(Math.round((column.offsetWidth - column.clientWidth) / 2));
		if (enabled) syncDockHeight({ column, block, viewport, body, shell, content }, expanded);
		else {
			block.style.removeProperty("--dock-max-h");
			viewport.style.removeProperty("max-height");
			viewport.style.removeProperty("overflow-y");
			shell.style.removeProperty("max-height");
		}
		if (!sheetDragging) onLayout?.();
		// ResizeObserver runs even when only a child field changed and React
		// did not rerender DockOverlay. Keep its transcript reserve current,
		// but never report a mid-morph height.
		if (shell.getAnimations().length === 0) onHeight(block.getBoundingClientRect().height);
	}, [scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef, expanded, enabled, onScrollbarInset, onHeight, onLayout]);

	// Imperative constraints land before the overlay's later layout effect
	// measures its morph target/reserve, and before paint (including reveal).
	useIsoLayoutEffect(measure);
	useIsoLayoutEffect(() => {
		sheetApply = measure;
		return () => { if (sheetApply === measure) sheetApply = null; };
	}, [measure]);
	useIsoLayoutEffect(() => {
		// Ignore already-queued deliveries after variant replacement or Activity
		// cleanup: old observers must never retarget a newer height animation.
		// A sheet drag applies its own frame; the observer must not remeasure under it.
		let active = true;
		const observedMeasure = () => { if (active && !sheetDragging) measure(); };
		const observer = new ResizeObserver(observedMeasure);
		for (const el of [scrollRef.current, blockRef.current, viewportRef.current, bodyRef.current, contentRef.current]) {
			if (el) observer.observe(el);
		}
		const question = expanded ? contentRef.current?.querySelector("[data-dock-scroll-area]") : null;
		if (question) observer.observe(question);
		window.addEventListener("resize", observedMeasure);
		window.visualViewport?.addEventListener("resize", observedMeasure);
		return () => {
			active = false;
			observer.disconnect();
			window.removeEventListener("resize", observedMeasure);
			window.visualViewport?.removeEventListener("resize", observedMeasure);
		};
	}, [measure, mode, expanded, scrollRef, blockRef, viewportRef, bodyRef, contentRef]);
}

/** Overlay and transcript are siblings. Keep native scrolling in an actual
 * scroll container (including the short-window viewport), then forward only
 * at its edge. overflow:hidden/visible boxes cannot consume the wheel. */
export function forwardDockWheel(event: WheelEvent, root: HTMLElement, transcript: HTMLElement) {
	if (event.deltaY === 0) return;
	for (let n = event.target as HTMLElement | null; n && n !== root; n = n.parentElement) {
		if (!(n instanceof HTMLElement) || !/^(auto|scroll)$/.test(getComputedStyle(n).overflowY)) continue;
		if (n.scrollHeight - n.clientHeight < 2) continue;
		if (event.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop < n.scrollHeight - n.clientHeight - 0.5) return;
	}
	event.preventDefault();
	transcript.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? transcript.clientHeight : 1);
}
