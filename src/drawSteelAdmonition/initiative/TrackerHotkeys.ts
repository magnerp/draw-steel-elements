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
 * Opening a note with a tracker turns them on for it right away, without a click. Until the tracker is clicked,
 * they leave keys typed in the note's editor alone.
 *
 * The active tracker is remembered by note path: Obsidian replaces a tracker with a new one each time the block
 * is saved, and the shortcuts have to carry over to it.
 */
export class TrackerHotkeys {
    private trackers = new Set<HotkeyTarget>();
    private activePath: string | null = null;
    // Whether the shortcuts came on by opening the note rather than by clicking the tracker
    private autoActive = false;
    // The note being looked at, and whether opening it has turned the shortcuts on yet
    private openPath: string | null = null;
    private autoDone = false;

    constructor(private plugin: DrawSteelAdmonitionPlugin) {
        // Capture phase: the tracker stops pointer events from reaching the note, and the editor
        // mustn't get the keys of a shortcut
        plugin.registerDomEvent(window, "pointerdown", (e) => this.onPointerDown(e), {capture: true});
        plugin.registerDomEvent(window, "keydown", (e) => this.onKeyDown(e), {capture: true});
        plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", () => this.autoActivate()));
    }

    /** Adds a rendered tracker; returns the function that removes it. */
    register(tracker: HotkeyTarget): () => void {
        this.trackers.add(tracker);
        tracker.setHotkeysActive(tracker.sourcePath === this.activePath);
        // The tracker of a note that was just opened renders after the note becomes active
        this.autoActivate();
        return () => this.trackers.delete(tracker);
    }

    private setActive(path: string | null, auto: boolean): void {
        this.activePath = path;
        this.autoActive = auto && path !== null;
        this.trackers.forEach((t) => t.setHotkeysActive(t.sourcePath === this.activePath));
    }

    /**
     * Turns the shortcuts on for the note being looked at, if it has a tracker. Only once per opening of the note,
     * so clicking outside the tracker turns them off for good until the note is opened again.
     */
    private autoActivate(): void {
        const path = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path ?? null;
        if (path !== this.openPath) {
            this.openPath = path;
            this.autoDone = false;
        }
        if (!path || this.autoDone) return;
        if (![...this.trackers].some((t) => t.sourcePath === path)) return;
        this.autoDone = true;
        if (this.activePath !== path) this.setActive(path, true);
    }

    private onPointerDown(e: PointerEvent): void {
        const target = e.target as HTMLElement;
        // Windows opened from the tracker (e.g. the stamina window) keep it active
        if (target.closest?.(".modal-container, .menu")) return;
        const clicked = [...this.trackers].find((t) => t.root.contains(target));
        this.setActive(clicked?.sourcePath ?? null, false);
    }

    private onKeyDown(e: KeyboardEvent): void {
        if (!this.activePath || e.isComposing) return;
        if (document.querySelector(".modal-container")) return;
        const target = e.target as HTMLElement;
        if (target.closest?.("input, textarea, select")) return;
        // Typing in the note's editor wins until the tracker is clicked
        if (this.autoActive && target.isContentEditable) return;

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
