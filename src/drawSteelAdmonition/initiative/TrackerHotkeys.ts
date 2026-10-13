import {MarkdownView} from "obsidian";
import {InitiativeHotkeyAction} from "@model/Settings";
import {actionForEvent} from "@utils/Hotkeys";
import DrawSteelAdmonitionPlugin from "main";

/** A rendered tracker that keyboard shortcuts can drive. */
export interface HotkeyTarget {
    readonly root: HTMLElement;
    readonly sourcePath: string;
    setHotkeysActive(active: boolean): void;
    runHotkey(action: InitiativeHotkeyAction): void;
}

/**
 * Sends the initiative shortcuts (set in the plugin settings) to the tracker that was clicked last. Clicking
 * anywhere outside a tracker turns them off again, so they never get in the way of typing in a note.
 *
 * The active tracker is remembered by note path: Obsidian replaces a tracker with a new one each time the block
 * is saved, and the shortcuts have to carry over to it.
 */
export class TrackerHotkeys {
    private trackers = new Set<HotkeyTarget>();
    private activePath: string | null = null;

    constructor(private plugin: DrawSteelAdmonitionPlugin) {
        // Capture phase: the tracker stops pointer events from reaching the note, and the editor
        // mustn't get the keys of a shortcut
        plugin.registerDomEvent(window, "pointerdown", (e) => this.onPointerDown(e), {capture: true});
        plugin.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e), {capture: true});
    }

    /** Adds a rendered tracker; returns the function that removes it. */
    register(tracker: HotkeyTarget): () => void {
        this.trackers.add(tracker);
        tracker.setHotkeysActive(tracker.sourcePath === this.activePath);
        return () => this.trackers.delete(tracker);
    }

    private onPointerDown(e: PointerEvent): void {
        const target = e.target as HTMLElement;
        // Windows opened from the tracker (e.g. the stamina window) keep it active
        if (target.closest?.(".modal-container, .menu")) return;
        const clicked = [...this.trackers].find((t) => t.root.contains(target));
        this.activePath = clicked?.sourcePath ?? null;
        this.trackers.forEach((t) => t.setHotkeysActive(t.sourcePath === this.activePath));
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (!this.activePath || e.isComposing) return;
        if (document.querySelector(".modal-container")) return;
        const target = e.target as HTMLElement;
        if (target.closest?.("input, textarea, select")) return;

        const action = actionForEvent(e, "tracker");
        if (!action) return;
        const tracker = this.activeTracker();
        if (!tracker) return;
        e.preventDefault();
        e.stopPropagation();
        tracker.runHotkey(action);
    }

    /** The active tracker, if its note is the one being looked at. */
    private activeTracker(): HotkeyTarget | null {
        const viewEl = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.containerEl;
        if (!viewEl) return null;
        return [...this.trackers].find((t) =>
            t.sourcePath === this.activePath && t.root.isConnected && viewEl.contains(t.root)
        ) ?? null;
    }
}
