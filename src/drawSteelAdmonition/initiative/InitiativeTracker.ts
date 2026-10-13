import {App, MarkdownPostProcessorContext, Notice, setIcon} from "obsidian";
import {RecoveryInfo, StaminaEditModal} from "@views/StaminaEditModal";
import {ConditionManager} from "@utils/Conditions";
import {ConditionsModal} from "@views/ConditionSelectModal";
import {Images} from "@utils/Images";
import {CodeBlocks} from "@utils/CodeBlocks";
import {Stamina} from "@utils/Stamina";
import {
    Condition,
    Creature,
    CreatureInstance,
    EncounterData,
    EnemyGroup,
    Hero,
    initEnemyGroup,
    resetEncounter,
    hasSharedStamina,
    snapshotParty,
} from "@drawSteelAdmonition/EncounterData";
import {ResetEncounterModal} from "@views/ResetEncounterModal";
import {ConfirmModal} from "@views/ConfirmModal";
import {AddEnemyGroupModal} from "@views/AddEnemyGroupModal";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {MinionStaminaPoolModal} from "@views/MinionStaminaPoolModal";
import {StaminaBar} from "@model/StaminaBar";
import {PartyStore} from "@drawSteelAdmonition/party/PartyData";
import {buildRecoveryControl} from "@drawSteelAdmonition/party/RecoveryControl";
import {CreatureView, StatblockCache, ViewedCreature} from "@drawSteelAdmonition/initiative/CreatureView";
import {buildStaminaMeter, setStaminaText, staminaState} from "@drawSteelAdmonition/initiative/StaminaMeter";
import {HeroSheetStore} from "@drawSteelAdmonition/hero/HeroSheet";
import {HotkeyTarget} from "@drawSteelAdmonition/initiative/TrackerHotkeys";
import {InitiativeHotkeyAction} from "@model/Settings";
import DrawSteelAdmonitionPlugin from "main";

/** Which hero or creature instance the creature view shows. */
type Selection =
    | { kind: "hero"; name: string }
    | { kind: "creature"; groupIndex: number; instanceKey: string };

// Kept per note (not in the code block) so selecting doesn't rewrite the YAML; the tracker re-renders
// after every change, so the selection and the view's scroll position have to outlive a render.
const selections = new Map<string, Selection>();
const viewScroll = new Map<string, number>();
const trackerScroll = new Map<string, number>();
// Resolved image sources by raw image reference, so re-renders add images synchronously (no flash)
const imageSources = new Map<string, string>();

// Whether each image source has transparent corners, so re-renders mark cut-outs synchronously (no flash)
const cutoutSources = new Map<string, Promise<boolean>>();

/**
 * Whether an image's corners are transparent, read from a small copy of it. Images the canvas may not read
 * (another origin without CORS) count as opaque.
 */
function hasTransparentCorners(src: string): Promise<boolean> {
    let result = cutoutSources.get(src);
    if (!result) {
        result = readCorners(src, false).catch(() => readCorners(src, true)).catch(() => false);
        cutoutSources.set(src, result);
    }
    return result;
}

function readCorners(src: string, anonymous: boolean): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (anonymous) image.crossOrigin = "anonymous";
        image.onload = () => {
            try {
                const size = 32;
                const canvas = document.createElement("canvas");
                canvas.width = size;
                canvas.height = size;
                const context = canvas.getContext("2d");
                if (!context) return resolve(false);
                context.drawImage(image, 0, 0, size, size);
                // Throws for a tainted canvas
                const {data} = context.getImageData(0, 0, size, size);
                const alpha = (x: number, y: number) => data[(y * size + x) * 4 + 3];
                const corners = [alpha(1, 1), alpha(size - 2, 1), alpha(1, size - 2), alpha(size - 2, size - 2)];
                resolve(corners.filter((a) => a < 32).length >= 3);
            } catch (e) {
                reject(e);
            }
        };
        image.onerror = () => reject(new Error(`Couldn't load ${src}`));
        image.src = src;
    });
}

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const MIN_HEIGHT = 200;
// Space left in the note pane around a tracker that fits it (pane padding and the height handle)
const FIT_MARGIN = 48;

export interface TrackerServices {
    plugin: DrawSteelAdmonitionPlugin;
    conditionManager: ConditionManager;
    statblocks: StatblockCache;
}

/**
 * One rendered ds-initiative block: the tracker (heroes, enemy groups, malice) on one side and the
 * creature view with the selected hero's or creature's stats and abilities on the other.
 */
export class InitiativeTracker implements HotkeyTarget {
    private app: App;
    private plugin: DrawSteelAdmonitionPlugin;
    private conditionManager: ConditionManager;
    private trackerEl: HTMLElement;
    private viewEl: HTMLElement;
    private creatureView: CreatureView;
    private layoutEl: HTMLElement;
    // Refits the height when the note pane is resized
    private paneObserver: ResizeObserver | null = null;

    constructor(
        services: TrackerServices,
        readonly root: HTMLElement,
        private data: EncounterData,
        private ctx: MarkdownPostProcessorContext,
    ) {
        this.plugin = services.plugin;
        this.app = services.plugin.app;
        this.conditionManager = services.conditionManager;
        this.creatureView = new CreatureView(this.plugin, services.statblocks, ctx, {
            buildSummary: (el, viewed) => this.buildViewSummary(el, viewed),
            bindStamina: (el, viewed) => this.bindViewStamina(el, viewed),
            onClose: () => this.select(null),
            onStep: (step) => this.selectSibling(step),
            siblingCount: (viewed) => viewed.kind === "hero"
                ? this.data.heroes.length
                : viewed.group.creatures.reduce((sum, creature) => sum + (creature.instances?.length ?? 0), 0),
        });
        this.keepWheelInTracker();
    }

    /**
     * Scrolling over the tracker scrolls the tracker or creature view, never the note: at either end of a side,
     * or over the toolbar or handles, the wheel does nothing.
     */
    private keepWheelInTracker(): void {
        this.root.addEventListener("wheel", (e) => {
            // Leave zooming and sideways scrolling alone
            if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
            const side = (e.target as HTMLElement).closest<HTMLElement>(".ds-init-tracker, .ds-init-view");
            const canScroll = side && (e.deltaY > 0
                ? side.scrollTop + side.clientHeight < side.scrollHeight - 1
                : side.scrollTop > 0);
            if (!canScroll) e.preventDefault();
        }, {passive: false});
    }

    /**
     * Adds a creature's or hero's image, at once if its source was resolved before. An image with transparent
     * corners (a round token, a cut-out) marks its container `is-cutout`, so it isn't framed in a square.
     */
    private addImage(container: HTMLElement, imageRaw: string | null | undefined, alt: string): void {
        const defaultPath = this.plugin.settings.defaultImagePath;
        const cacheKey = `${imageRaw ?? ""}\n${defaultPath}`;
        const show = (src: string) => {
            container.createEl("img", {attr: {src, alt}});
            hasTransparentCorners(src).then((cutout) => container.toggleClass("is-cutout", cutout));
        };
        const known = imageSources.get(cacheKey);
        if (known) {
            show(known);
            return;
        }
        Images.resolveImageSourceOrDefault(this.app, imageRaw ?? null, defaultPath).then((imgSrc) => {
            imageSources.set(cacheKey, imgSrc);
            show(imgSrc);
        });
    }

    public get encounter(): EncounterData {
        return this.data;
    }

    public get sourcePath(): string {
        return this.ctx.sourcePath;
    }

    public render(): void {
        this.root.empty();
        this.root.addClass("ds-it");
        const layout = this.root.createEl("div", {cls: "ds-init-layout"});
        this.layoutEl = layout;
        this.trackerEl = layout.createEl("div", {cls: "ds-init-tracker"});
        const splitter = layout.createEl("div", {
            cls: "ds-init-resizer ds-init-splitter",
            attr: {title: "Drag to resize the tracker and creature view"},
        });
        this.viewEl = layout.createEl("div", {cls: "ds-init-view"});
        const heightHandle = this.root.createEl("div", {
            cls: "ds-init-resizer ds-init-height-handle",
            attr: {title: "Drag to change the height. Double-click to fit the note pane again"},
        });
        this.applyLayout(layout);
        this.makeResizable(layout, splitter, heightHandle);

        this.trackerEl.addEventListener("scroll", () => trackerScroll.set(this.ctx.sourcePath, this.trackerEl.scrollTop));
        this.viewEl.addEventListener("scroll", () => viewScroll.set(this.ctx.sourcePath, this.viewEl.scrollTop));

        this.buildTracker(this.trackerEl);
        this.renderView();
        this.whenAttached();
    }

    /**
     * Fits the height to the note pane and restores the tracker's and view's scroll positions. When Obsidian
     * re-renders the block (after every save, e.g. selecting a creature) it isn't in the page yet: there's no pane
     * to measure, and a detached element ignores scrollTop. A mutation observer does both as soon as the block is
     * attached, before the page is painted (no jump).
     */
    private whenAttached(): void {
        const trackerEl = this.trackerEl;
        const viewEl = this.viewEl;
        const restore = () => {
            this.fitHeight();
            trackerEl.scrollTop = trackerScroll.get(this.ctx.sourcePath) ?? 0;
            viewEl.scrollTop = viewScroll.get(this.ctx.sourcePath) ?? 0;
        };
        if (trackerEl.isConnected) {
            restore();
            return;
        }
        const observer = new MutationObserver(() => {
            if (!trackerEl.isConnected) return;
            observer.disconnect();
            window.clearTimeout(timeout);
            // A newer render replaced these elements; it restores the scroll itself
            if (this.trackerEl === trackerEl) restore();
        });
        observer.observe(document.body, {childList: true, subtree: true});
        // Give up if the block is never attached (e.g. the note was closed)
        const timeout = window.setTimeout(() => observer.disconnect(), 5000);
    }

    // ---------------------------------------------------------------------------------------------
    // Resizing
    // ---------------------------------------------------------------------------------------------

    /** The note pane the tracker scrolls in: reading view or live preview. */
    private notePane(): HTMLElement | null {
        return this.root.closest<HTMLElement>(".markdown-preview-view, .cm-scroller");
    }

    /**
     * Without a dragged height, the tracker fills the note pane (less a margin), refitting when the pane is
     * resized.
     */
    private fitHeight(): void {
        const pane = this.notePane();
        if (!pane || this.plugin.settings.initiativeLayout?.height) return;
        this.layoutEl.style.setProperty("--ds-init-height", `${Math.max(MIN_HEIGHT, pane.clientHeight - FIT_MARGIN)}px`);
        if (!this.paneObserver) {
            this.paneObserver = new ResizeObserver(() => {
                // This tracker was replaced by a newer render of the block
                if (!this.root.isConnected) {
                    this.paneObserver?.disconnect();
                    return;
                }
                this.fitHeight();
            });
            this.paneObserver.observe(pane);
        }
    }

    /** Applies the saved width split and height (shared by all trackers). */
    private applyLayout(layout: HTMLElement): void {
        const saved = this.plugin.settings.initiativeLayout ?? {};
        const ratio = saved.trackerRatio ?? 0.5;
        this.trackerEl.style.flexGrow = `${ratio}`;
        this.viewEl.style.flexGrow = `${1 - ratio}`;
        if (saved.height) {
            layout.style.setProperty("--ds-init-height", `${saved.height}px`);
        }
    }

    /** Dragging the splitter changes the width split, dragging the bottom handle the height. */
    private makeResizable(layout: HTMLElement, splitter: HTMLElement, heightHandle: HTMLElement): void {
        const settings = this.plugin.settings;
        this.onDrag(splitter, (e) => {
            const rect = layout.getBoundingClientRect();
            const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, (e.clientX - rect.left) / rect.width));
            settings.initiativeLayout = {...settings.initiativeLayout, trackerRatio: ratio};
            this.applyLayout(layout);
        });
        this.onDrag(heightHandle, (e) => {
            const height = Math.max(MIN_HEIGHT, Math.round(e.clientY - layout.getBoundingClientRect().top));
            settings.initiativeLayout = {...settings.initiativeLayout, height};
            this.applyLayout(layout);
        });
        // Back to fitting the note pane
        heightHandle.addEventListener("dblclick", () => {
            const {height, ...rest} = settings.initiativeLayout ?? {};
            settings.initiativeLayout = rest;
            this.plugin.saveSettings();
            this.fitHeight();
        });
    }

    /** Calls `onMove` while `handle` is dragged and saves the settings once it's released. */
    private onDrag(handle: HTMLElement, onMove: (e: PointerEvent) => void): void {
        handle.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);
            handle.addClass("is-dragging");
            const move = (ev: PointerEvent) => onMove(ev);
            const up = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", up);
                handle.removeEventListener("pointercancel", up);
                handle.removeClass("is-dragging");
                this.plugin.saveSettings();
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", up);
            handle.addEventListener("pointercancel", up);
        });
    }

    private save(): Promise<void> {
        return CodeBlocks.updateInitiativeTracker(this.app, this.data, this.ctx);
    }

    /** Re-renders the tracker and creature view with the changed encounter, then saves it. */
    private refresh(): Promise<void> {
        this.render();
        return this.save();
    }

    /** Saves a hero's stamina/recoveries: to the party note for party heroes, otherwise to this code block. */
    private async saveHeroStamina(hero: Hero): Promise<void> {
        if (hero.sheet_path) {
            await HeroSheetStore.saveHero(this.app, hero);
        } else if (hero.from_party && this.data.party) {
            const file = PartyStore.resolveFile(this.app, this.data.party, this.ctx.sourcePath);
            await PartyStore.saveHeroes(this.app, file, [hero]);
        } else {
            await this.save();
        }
    }

    /** Saves the stamina/recoveries of heroes stored outside this block, writing the party note once. */
    private async saveSharedHeroes(heroes: Hero[]): Promise<void> {
        const partyHeroes = heroes.filter((hero) => hero.from_party);
        if (partyHeroes.length > 0 && this.data.party) {
            const file = PartyStore.resolveFile(this.app, this.data.party, this.ctx.sourcePath);
            await PartyStore.saveHeroes(this.app, file, partyHeroes);
        }
        for (const hero of heroes.filter((h) => !h.from_party)) {
            await HeroSheetStore.saveHero(this.app, hero);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Selection / creature view
    // ---------------------------------------------------------------------------------------------

    private heroSelectionKey(hero: Hero): string {
        return `hero:${hero.name}`;
    }

    private creatureSelectionKey(group: EnemyGroup, instanceKey: string): string {
        return `creature:${this.data.enemy_groups.indexOf(group)}:${instanceKey}`;
    }

    private selectionKey(selection: Selection | undefined): string | null {
        if (!selection) return null;
        return selection.kind === "hero"
            ? `hero:${selection.name}`
            : `creature:${selection.groupIndex}:${selection.instanceKey}`;
    }

    private select(selection: Selection | null): void {
        if (selection) {
            selections.set(this.ctx.sourcePath, selection);
        } else {
            selections.delete(this.ctx.sourcePath);
        }
        viewScroll.delete(this.ctx.sourcePath);
        this.markViewed();
        this.renderView();
        this.viewEl.scrollTop = 0;
    }

    private selectHero(hero: Hero): void {
        this.select({kind: "hero", name: hero.name});
    }

    private selectCreature(group: EnemyGroup, instanceKey: string): void {
        this.select({kind: "creature", groupIndex: this.data.enemy_groups.indexOf(group), instanceKey});
    }

    /**
     * Shows a creature in its group's focus row and in the creature view. The focus row is saved with the
     * group, so the whole tracker re-renders and the block is saved.
     */
    private focusCreature(group: EnemyGroup, instanceKey: string): void {
        group.selectedInstanceKey = instanceKey;
        selections.set(this.ctx.sourcePath, {kind: "creature", groupIndex: this.data.enemy_groups.indexOf(group), instanceKey});
        viewScroll.delete(this.ctx.sourcePath);
        this.refresh();
    }

    /** The current selection resolved against the encounter, or null if it no longer exists. */
    private viewed(): ViewedCreature | null {
        const selection = selections.get(this.ctx.sourcePath);
        if (!selection) return null;
        if (selection.kind === "hero") {
            const hero = this.data.heroes.find((h) => h.name === selection.name);
            return hero ? {kind: "hero", hero} : null;
        }
        const group = this.data.enemy_groups[selection.groupIndex];
        const found = group && this.findInstance(group, selection.instanceKey);
        return found ? {kind: "creature", group, ...found} : null;
    }

    private renderView(): void {
        this.creatureView.render(this.viewEl, this.viewed());
    }

    /** Highlights the rows/cells shown in the creature view. */
    private markViewed(): void {
        const key = this.selectionKey(selections.get(this.ctx.sourcePath));
        this.trackerEl.querySelectorAll<HTMLElement>("[data-view-key]").forEach((el) => {
            el.toggleClass("is-viewed", el.dataset.viewKey === key);
        });
    }

    private setViewKey(el: HTMLElement, key: string): void {
        el.dataset.viewKey = key;
        el.toggleClass("is-viewed", key === this.selectionKey(selections.get(this.ctx.sourcePath)));
    }

    /** Portrait, name, conditions, stamina and recoveries at the top of the creature view. */
    private buildViewSummary(container: HTMLElement, viewed: ViewedCreature): void {
        const character = viewed.kind === "hero" ? viewed.hero : viewed.instance;
        const name = viewed.kind === "hero" ? viewed.hero.name : `${viewed.creature.name} #${viewed.instance.id}`;
        const image = viewed.kind === "hero" ? viewed.hero.image : viewed.creature.image;
        const stamina = viewed.kind === "hero"
            ? staminaState(viewed.hero)
            : staminaState(viewed.instance, viewed.creature, viewed.group);
        container.toggleClass("is-dead", stamina.status === "dead");

        const identityEl = container.createEl("div", {cls: "ds-cv-identity"});
        this.addImage(identityEl.createEl("div", {cls: "ds-cv-portrait"}), image ?? null, name);

        const textEl = identityEl.createEl("div", {cls: "ds-cv-text"});
        const kickerEl = textEl.createEl("div", {cls: "ds-cv-kicker"});
        if (viewed.kind === "hero") {
            kickerEl.createSpan({text: "Hero"});
        } else {
            kickerEl.createSpan({text: viewed.group.name});
            const role = this.roleLabel(viewed.creature);
            if (role) kickerEl.createSpan({cls: "ds-it-tag", text: role});
        }
        textEl.createEl("div", {cls: "ds-cv-name", text: name});
        this.buildConditions(textEl.createEl("div", {cls: "ds-it-conditions ds-cv-conditions"}), character, name, true);

        const vitalsEl = container.createEl("div", {cls: "ds-cv-vitals"});
        const meterEl = buildStaminaMeter(vitalsEl, stamina, true);
        meterEl.addClass("is-clickable");
        meterEl.setAttr("aria-label", "Edit Stamina");
        meterEl.addEventListener("click", () => this.openStaminaModal(viewed));
        if (viewed.kind === "hero") {
            const hero = viewed.hero;
            buildRecoveryControl(vitalsEl, hero, () => {
                this.render();
                this.saveHeroStamina(hero);
            });
        }
    }

    /** Shows the viewed hero's or creature's stamina in `el` (the statblock's Stamina stat); clicking edits it. */
    private bindViewStamina(el: HTMLElement, viewed: ViewedCreature): void {
        setStaminaText(el, viewed.kind === "hero"
            ? staminaState(viewed.hero)
            : staminaState(viewed.instance, viewed.creature, viewed.group));
        const title = el.title;
        el.parentElement?.setAttr("title", title ? `${title}. Click to edit Stamina` : "Edit Stamina");
        el.title = "";
        el.addEventListener("click", () => this.openStaminaModal(viewed));
    }

    /**
     * The stamina window of a hero or creature: a squad's pool for its minions. The whole tracker re-renders
     * afterwards so the tracker and creature view both show the new stamina.
     */
    private openStaminaModal(viewed: ViewedCreature): void {
        if (viewed.kind === "hero") {
            const hero = viewed.hero;
            const staminaBar = StaminaBar.fromHero(hero);
            new StaminaEditModal(this.app, staminaBar, true, hero.name, (result) => {
                staminaBar.updateHero(hero);
                if (hero.max_recoveries != null) {
                    hero.current_recoveries = (hero.current_recoveries ?? hero.max_recoveries) - result.recoveriesSpent;
                }
                this.render();
                this.saveHeroStamina(hero);
            }, true, this.recoveryInfo(hero)).open();
            return;
        }

        const {group, creature, instance} = viewed;
        if (group.is_squad && creature.squad_role === "minion") {
            this.openPoolModal(group, creature);
            return;
        }
        const staminaBar = StaminaBar.fromCreature(instance, creature);
        new StaminaEditModal(this.app, staminaBar, false, creature.name, () => {
            staminaBar.updateCreature(instance);
            this.refresh();
        }, creature.squad_role !== "minion").open();
    }

    /** Minions in a squad share the pool's stamina. */
    private openPoolModal(group: EnemyGroup, minion: Creature): void {
        new MinionStaminaPoolModal(this.app, group, minion, this.data, this.ctx, () => this.refresh()).open();
    }

    // ---------------------------------------------------------------------------------------------
    // Keyboard shortcuts
    // ---------------------------------------------------------------------------------------------

    /** Outlines the tracker while the keyboard shortcuts go to it. */
    public setHotkeysActive(active: boolean): void {
        this.root.toggleClass("is-hotkeys-active", active);
    }

    public runHotkey(action: InitiativeHotkeyAction): void {
        switch (action) {
            case "editStamina":
            case "kill": {
                const viewed = this.viewed();
                if (!viewed) {
                    new Notice("Select a hero or creature first.");
                } else if (action === "editStamina") {
                    this.openStaminaModal(viewed);
                } else if (viewed.kind === "hero") {
                    new Notice("Only creatures can be killed with the shortcut.");
                } else if (this.killCreatureInstance(viewed.group, viewed.creature, viewed.instance)) {
                    this.refresh();
                }
                break;
            }
            case "selectNext":
                this.selectSibling(1);
                break;
            case "selectPrevious":
                this.selectSibling(-1);
                break;
            case "nextGroup":
                this.selectGroup(1);
                break;
            case "previousGroup":
                this.selectGroup(-1);
                break;
            case "resetRound":
                this.resetRound();
                break;
            case "editConditions":
            case "clearConditions": {
                const viewed = this.viewed();
                if (!viewed) {
                    new Notice("Select a hero or creature first.");
                    break;
                }
                const character = viewed.kind === "hero" ? viewed.hero : viewed.instance;
                const name = viewed.kind === "hero" ? viewed.hero.name : `${viewed.creature.name} #${viewed.instance.id}`;
                if (action === "editConditions") {
                    this.openConditions(character, name);
                } else if (!character.conditions?.length) {
                    new Notice(`${name} has no conditions.`);
                } else {
                    character.conditions = [];
                    new Notice(`Cleared the conditions of ${name}.`);
                    this.refresh();
                }
                break;
            }
        }
    }

    /**
     * Selects the next (`step` 1) or previous (-1) hero, or creature in the selected creature's group,
     * wrapping around at the ends.
     */
    private selectSibling(step: number): void {
        const selection = selections.get(this.ctx.sourcePath);
        if (!selection || !this.viewed()) {
            new Notice("Select a hero or creature first.");
            return;
        }
        if (selection.kind === "hero") {
            const heroes = this.data.heroes;
            const index = heroes.findIndex((h) => h.name === selection.name);
            this.selectHero(heroes[(index + step + heroes.length) % heroes.length]);
        } else {
            const group = this.data.enemy_groups[selection.groupIndex];
            const keys = group.creatures.flatMap((creature, creatureIndex) =>
                (creature.instances ?? []).map((instance) => `${creatureIndex}-${instance.id}`)
            );
            const index = keys.indexOf(selection.instanceKey);
            // The group's focus row follows the selection, as when clicking a token
            this.focusCreature(group, keys[(index + step + keys.length) % keys.length]);
        }
        this.scrollToSelection();
    }

    /**
     * Moves the selection to the next (`step` 1) or previous (-1) group, wrapping around: the heroes come first,
     * then each enemy group. An enemy group selects the creature in its focus row, as clicking the group does;
     * the heroes select the first hero.
     */
    private selectGroup(step: number): void {
        // -1 stands for the heroes
        const groups: number[] = [];
        if (this.data.heroes.length > 0) groups.push(-1);
        this.data.enemy_groups.forEach((group, index) => {
            if (this.shownInstance(group)) groups.push(index);
        });
        if (groups.length === 0) return;

        const selection = this.viewed() ? selections.get(this.ctx.sourcePath) : undefined;
        const current = selection ? groups.indexOf(selection.kind === "hero" ? -1 : selection.groupIndex) : -1;
        // With nothing selected, go to the first (or, backwards, the last) group
        const target = current === -1
            ? (step > 0 ? groups[0] : groups[groups.length - 1])
            : groups[(current + step + groups.length) % groups.length];

        if (target === -1) {
            this.selectHero(this.data.heroes[0]);
        } else {
            const group = this.data.enemy_groups[target];
            const shown = this.shownInstance(group)!;
            this.selectCreature(group, `${group.creatures.indexOf(shown.creature)}-${shown.instance.id}`);
        }
        this.scrollToSelection();
    }

    /** Scrolls the tracker so the selected row or token is visible, and remembers it for the next render. */
    private scrollToSelection(): void {
        const selected = this.trackerEl.querySelector(".creature-instance-cell.is-viewed")
            ?? this.trackerEl.querySelector(".is-viewed");
        selected?.scrollIntoView({block: "nearest"});
        trackerScroll.set(this.ctx.sourcePath, this.trackerEl.scrollTop);
    }

    private resetRound(): void {
        this.data.heroes.forEach((hero) => {
            hero.has_taken_turn = false;
        });
        this.data.enemy_groups.forEach((group) => {
            group.has_taken_turn = false;
        });
        this.refresh();
    }

    // ---------------------------------------------------------------------------------------------
    // Tracker
    // ---------------------------------------------------------------------------------------------

    private buildTracker(container: HTMLElement): void {
        this.buildToolbar(container);
        this.buildHeroes(container);
        this.buildEnemies(container);
    }

    /** A toolbar button: an icon, with its label shown when `showLabel` (otherwise a tooltip). */
    private button(container: HTMLElement, icon: string, label: string, onClick: () => void, showLabel = false): HTMLElement {
        const buttonEl = container.createEl("button", {cls: "ds-it-button", attr: {"aria-label": label}});
        setIcon(buttonEl.createSpan({cls: "ds-it-button-icon"}), icon);
        if (showLabel) buttonEl.createSpan({cls: "ds-it-button-label", text: label});
        buttonEl.addEventListener("click", (e) => {
            e.stopPropagation();
            onClick();
        });
        return buttonEl;
    }

    /** Round progress and New Round, Malice, and the encounter actions. */
    private buildToolbar(container: HTMLElement): void {
        const data = this.data;
        const toolbar = container.createEl("div", {cls: "ds-it-toolbar"});

        // Round: who has acted, and starting the next round
        const roundEl = toolbar.createEl("div", {cls: "ds-it-round"});
        const turns = [...data.heroes, ...data.enemy_groups];
        const acted = turns.filter((turn) => turn.has_taken_turn).length;
        this.button(roundEl, "rotate-ccw", "New round", () => this.resetRound(), true)
            .setAttr("aria-label", "New round: clear every turn taken");
        const progressEl = roundEl.createEl("div", {
            cls: "ds-it-round-progress",
            attr: {title: `${acted} of ${turns.length} have taken their turn this round`},
        });
        progressEl.createSpan({cls: "ds-it-round-count", text: `${acted}/${turns.length}`});
        progressEl.createSpan({cls: "ds-it-round-label", text: "acted"});
        const barEl = progressEl.createEl("div", {cls: "ds-it-round-bar"});
        barEl.createEl("div").style.width = turns.length ? `${acted / turns.length * 100}%` : "0";
        progressEl.toggleClass("is-complete", turns.length > 0 && acted === turns.length);

        // Malice
        const maliceEl = toolbar.createEl("div", {cls: "ds-it-malice"});
        const valueEl = maliceEl.createEl("div", {cls: "ds-it-malice-value", attr: {title: "Malice"}});
        setIcon(valueEl.createSpan({cls: "ds-it-malice-icon"}), "flame");
        const numberEl = valueEl.createSpan({cls: "ds-it-malice-number", text: `${data.malice.value}`});
        valueEl.createSpan({cls: "ds-it-malice-label", text: "Malice"});
        const changeMalice = (delta: number) => {
            data.malice.value += delta;
            numberEl.setText(`${data.malice.value}`);
            this.save();
        };
        maliceEl.prepend(this.button(maliceEl, "minus", "Spend Malice", () => changeMalice(-1)));
        this.button(maliceEl, "plus", "Gain Malice", () => changeMalice(1));

        // Encounter actions
        const actionsEl = toolbar.createEl("div", {cls: "ds-it-actions"});
        this.button(actionsEl, "plus", "Add enemy group", () => {
            new AddEnemyGroupModal(this.app, this.plugin.settings, async (group) => {
                // Same setup as groups written in the YAML (statblocks, minion squads, instances)
                const resolver = new ReferenceResolver(this.app, this.plugin.settings);
                await initEnemyGroup(group, data.enemy_groups.length, resolver);
                data.enemy_groups.push(group);
                await this.refresh();
            }).open();
        });
        // What "Reset encounter" brings the party back to
        if (data.heroes.some(hasSharedStamina)) {
            this.button(actionsEl, "save", "Save party state: resetting the encounter restores the party's current Stamina and Recoveries", async () => {
                snapshotParty(data);
                await this.save();
                new Notice("Party state saved. Resetting the encounter will restore it.");
            });
        }
        this.button(actionsEl, "history", "Reset encounter", () => {
            new ResetEncounterModal(this.app, !!data.party_snapshot, async () => {
                const restored = await resetEncounter(data, new ReferenceResolver(this.app, this.plugin.settings));
                await this.refresh();
                await this.saveSharedHeroes(restored);
            }).open();
        });
    }

    private buildSectionHeader(section: HTMLElement, icon: string, title: string): HTMLElement {
        const headerEl = section.createEl("div", {cls: "ds-it-section-header"});
        setIcon(headerEl.createSpan({cls: "ds-it-section-icon"}), icon);
        headerEl.createEl("h3", {text: title});
        return headerEl;
    }

    /** How many of these have yet to act this round. */
    private toActText(turns: { has_taken_turn?: boolean }[]): string {
        const waiting = turns.filter((turn) => !turn.has_taken_turn).length;
        return waiting === 0 ? "all acted" : `${waiting} to act`;
    }

    private buildHeroes(container: HTMLElement): void {
        const data = this.data;
        const section = container.createEl("div", {cls: "ds-it-section is-heroes"});
        const headerEl = this.buildSectionHeader(section, "shield", "Heroes");
        if (data.heroes.length > 0) {
            headerEl.createSpan({cls: "ds-it-section-count", text: this.toActText(data.heroes)});
        }
        if (data.party) {
            const partyEl = headerEl.createSpan({
                cls: "ds-it-party",
                attr: {title: "Stamina and Recoveries of party heroes are shared with every encounter using this party"},
            });
            setIcon(partyEl.createSpan(), "link");
            partyEl.createSpan({text: data.party.replace(/^\[\[|\]\]$/g, "")});
        }

        if (data.heroes.length === 0) {
            section.createEl("div", {cls: "ds-it-empty", text: "No heroes in this encounter."});
        }
        data.heroes.forEach((hero) => this.buildHeroCard(section, hero));
    }

    private buildEnemies(container: HTMLElement): void {
        const data = this.data;
        const section = container.createEl("div", {cls: "ds-it-section is-enemies"});
        const headerEl = this.buildSectionHeader(section, "swords", "Enemies");
        if (data.enemy_groups.length > 0) {
            headerEl.createSpan({cls: "ds-it-section-count", text: this.toActText(data.enemy_groups)});
        }

        if (data.enemy_groups.length === 0) {
            section.createEl("div", {cls: "ds-it-empty", text: "No enemy groups. Add one from the toolbar."});
        }
        data.enemy_groups.forEach((group) => this.buildGroupCard(section, group));
    }

    /** The strip on the left of a card that marks the hero's or group's turn as taken. */
    private buildTurnToggle(card: HTMLElement, turn: Hero | EnemyGroup): void {
        const acted = turn.has_taken_turn ?? false;
        card.toggleClass("has-acted", acted);
        const toggleEl = card.createEl("button", {
            cls: "ds-it-turn",
            attr: {"aria-label": acted ? "Turn taken (click to undo)" : "Mark turn taken"},
        });
        setIcon(toggleEl, acted ? "check" : "circle");
        toggleEl.addEventListener("click", (e) => {
            e.stopPropagation();
            turn.has_taken_turn = !acted;
            this.refresh();
        });
    }

    private buildPortrait(container: HTMLElement, image: string | null | undefined, name: string): HTMLElement {
        const portraitEl = container.createEl("div", {cls: "ds-it-portrait"});
        this.addImage(portraitEl, image, name);
        return portraitEl;
    }

    /**
     * Double-clicking a card or row opens the stamina window, except on its own controls (turn, stamina,
     * conditions, recoveries), which handle their clicks themselves.
     */
    private onDoubleClick(el: HTMLElement, viewed: ViewedCreature): void {
        el.addEventListener("dblclick", (e) => {
            if ((e.target as HTMLElement).closest("button, .ds-it-stamina, .ds-it-condition, .hero-recoveries")) return;
            this.openStaminaModal(viewed);
        });
    }

    /** Middle-click opens the conditions window of the hero or creature. */
    private onMiddleClick(el: HTMLElement, character: Hero | CreatureInstance, name: string): void {
        el.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.openConditions(character, name);
        });
    }

    private buildHeroCard(container: HTMLElement, hero: Hero): void {
        const card = container.createEl("div", {cls: "ds-it-card ds-it-hero"});
        this.buildTurnToggle(card, hero);

        const rowEl = card.createEl("div", {cls: "ds-it-row"});
        // Click to show this hero in the creature view
        this.setViewKey(card, this.heroSelectionKey(hero));
        rowEl.addEventListener("click", () => this.selectHero(hero));
        this.onDoubleClick(rowEl, {kind: "hero", hero});
        this.onMiddleClick(rowEl, hero, hero.name);

        const stamina = staminaState(hero);
        card.addClass(`is-${stamina.status}`);
        this.buildPortrait(rowEl, hero.image, hero.name);

        const mainEl = rowEl.createEl("div", {cls: "ds-it-main"});
        mainEl.createEl("div", {cls: "ds-it-name", text: hero.name});
        this.buildConditions(mainEl.createEl("div", {cls: "ds-it-conditions"}), hero, hero.name);

        const vitalsEl = rowEl.createEl("div", {cls: "ds-it-vitals"});
        const meterEl = buildStaminaMeter(vitalsEl, stamina);
        meterEl.addClass("is-clickable");
        meterEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openStaminaModal({kind: "hero", hero});
        });
        buildRecoveryControl(vitalsEl, hero, () => {
            this.render();
            this.saveHeroStamina(hero);
        });
    }

    private recoveryInfo(hero: Hero): RecoveryInfo | undefined {
        if (hero.max_recoveries == null) {
            return undefined;
        }
        return {
            current: hero.current_recoveries ?? hero.max_recoveries,
            max: hero.max_recoveries,
            value: Stamina.recoveryValue(hero.max_stamina, hero.recovery_value),
        };
    }

    /** Finds a creature instance in a group by its `<creatureIndex>-<instanceId>` key. */
    private findInstance(group: EnemyGroup, instanceKey: string): { creature: Creature; instance: CreatureInstance } | null {
        for (let creatureIndex = 0; creatureIndex < group.creatures.length; creatureIndex++) {
            const creature = group.creatures[creatureIndex];
            const instance = creature.instances?.find((inst) => `${creatureIndex}-${inst.id}` === instanceKey);
            if (instance) {
                return {creature, instance};
            }
        }
        return null;
    }

    /** The instance shown in a group's focus row: the last selected one, else the first. */
    private shownInstance(group: EnemyGroup): { creature: Creature; instance: CreatureInstance } | null {
        const selected = group.selectedInstanceKey != null ? this.findInstance(group, group.selectedInstanceKey) : null;
        if (selected) return selected;
        for (const creature of group.creatures) {
            if (creature.instances && creature.instances.length > 0) {
                return {creature, instance: creature.instances[0]};
            }
        }
        return null;
    }

    private roleLabel(creature: Creature): string | null {
        if (creature.squad_role === "minion") return "Minion";
        if (creature.squad_role === "captain") return "Captain";
        return null;
    }

    private buildGroupCard(container: HTMLElement, group: EnemyGroup): void {
        const card = container.createEl("div", {cls: "ds-it-card ds-it-group"});
        this.buildTurnToggle(card, group);
        const single = group.creatures.length === 1 && group.creatures[0].amount === 1;
        card.toggleClass("is-single", single);

        const bodyEl = card.createEl("div", {cls: "ds-it-group-body"});
        // Clicking anywhere else on the group shows the creature in its focus row (the only one, or the
        // last selected); tokens and the focus row select their own creature
        bodyEl.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).closest(".creature-instance-cell, .creature-detail-row, button")) return;
            const shown = this.shownInstance(group);
            if (shown) {
                this.selectCreature(group, `${group.creatures.indexOf(shown.creature)}-${shown.instance.id}`);
            }
        });

        const headerEl = bodyEl.createEl("div", {cls: "ds-it-group-header"});
        headerEl.createEl("h4", {cls: "ds-it-group-name", text: group.name});

        const states = group.creatures.flatMap((creature) =>
            (creature.instances ?? []).map((instance) => staminaState(instance, creature, group))
        );
        const alive = states.filter((state) => state.status !== "dead").length;
        if (!single) {
            headerEl.createSpan({
                cls: "ds-it-group-count",
                text: `${alive}/${states.length}`,
                attr: {title: `${alive} of ${states.length} creatures alive`},
            });
        }
        if (group.is_squad) headerEl.createSpan({cls: "ds-it-tag", text: "Squad"});
        card.toggleClass("is-defeated", states.length > 0 && alive === 0);

        // Remove the whole group from the encounter
        const removeEl = headerEl.createEl("button", {
            cls: "ds-it-icon-button ds-it-remove",
            attr: {"aria-label": "Remove group from encounter"},
        });
        setIcon(removeEl, "trash-2");
        removeEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.confirmRemoveGroup(group);
        });

        // The squad's shared stamina pool
        const minion = group.is_squad ? group.creatures.find((creature) => creature.squad_role === "minion") : undefined;
        if (minion) {
            const poolEl = bodyEl.createEl("div", {cls: "ds-it-pool", attr: {"aria-label": "Edit the squad's Stamina pool"}});
            poolEl.createSpan({cls: "ds-it-pool-label", text: "Squad pool"});
            buildStaminaMeter(poolEl, staminaState({id: 0}, minion, group));
            poolEl.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openPoolModal(group, minion);
            });
        }

        const shown = this.shownInstance(group);
        if (shown) {
            this.buildCreatureRow(bodyEl, shown.creature, shown.instance, group, single);
        }

        // A single creature needs no tokens
        if (single) return;

        const tokensEl = bodyEl.createEl("div", {cls: "ds-it-tokens"});
        group.creatures.forEach((creature, creatureIndex) => {
            creature.instances?.forEach((instance) => {
                this.buildToken(tokensEl, group, creature, instance, `${creatureIndex}-${instance.id}`);
            });
        });
    }

    private confirmRemoveGroup(group: EnemyGroup): void {
        const data = this.data;
        new ConfirmModal(
            this.app,
            "Remove enemy group?",
            `Remove '${group.name}' and all its creatures from this encounter? This can't be undone from the tracker.`,
            "Remove",
            () => {
                const removedIndex = data.enemy_groups.indexOf(group);
                data.enemy_groups = data.enemy_groups.filter((g) => g !== group);
                // Keep the creature view on the same creature; clear it if it was in this group
                const selection = selections.get(this.ctx.sourcePath);
                if (selection?.kind === "creature") {
                    if (selection.groupIndex === removedIndex) {
                        selections.delete(this.ctx.sourcePath);
                    } else if (selection.groupIndex > removedIndex) {
                        selection.groupIndex -= 1;
                    }
                }
                this.refresh();
            }
        ).open();
    }

    /** The group's focus row: the selected creature with its conditions and stamina. */
    private buildCreatureRow(
        container: HTMLElement,
        creature: Creature,
        instance: CreatureInstance,
        group: EnemyGroup,
        single: boolean,
    ): void {
        const rowEl = container.createEl("div", {cls: "creature-detail-row ds-it-row ds-it-focus"});

        // Click to show this creature in the creature view
        const instanceKey = `${group.creatures.indexOf(creature)}-${instance.id}`;
        this.setViewKey(rowEl, this.creatureSelectionKey(group, instanceKey));
        rowEl.addEventListener("click", () => this.selectCreature(group, instanceKey));
        this.onDoubleClick(rowEl, {kind: "creature", group, creature, instance});
        this.onMiddleClick(rowEl, instance, `${creature.name} #${instance.id}`);

        const stamina = staminaState(instance, creature, group);
        rowEl.addClass(`is-${stamina.status}`);
        this.buildPortrait(rowEl, creature.image, creature.name);

        const mainEl = rowEl.createEl("div", {cls: "ds-it-main"});
        const nameEl = mainEl.createEl("div", {cls: "ds-it-name"});
        nameEl.createSpan({text: single ? creature.name : `${creature.name} #${instance.id}`});
        const role = this.roleLabel(creature);
        if (role) nameEl.createSpan({cls: "ds-it-tag", text: role});
        this.buildConditions(mainEl.createEl("div", {cls: "ds-it-conditions"}), instance, `${creature.name} #${instance.id}`);

        const vitalsEl = rowEl.createEl("div", {cls: "ds-it-vitals"});
        const meterEl = buildStaminaMeter(vitalsEl, stamina);
        meterEl.addClass("is-clickable");
        meterEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openStaminaModal({kind: "creature", group, creature, instance});
        });
    }

    /** One creature of a group: its portrait ringed by its stamina, with conditions and stamina below. */
    private buildToken(
        container: HTMLElement,
        group: EnemyGroup,
        creature: Creature,
        instance: CreatureInstance,
        instanceKey: string,
    ): void {
        const stamina = staminaState(instance, creature, group);
        const squadMinion = group.is_squad && creature.squad_role === "minion";
        const tokenEl = container.createEl("div", {
            cls: `creature-instance-cell ds-it-token is-${stamina.status}`,
            attr: {title: `${creature.name} #${instance.id}`},
        });
        tokenEl.dataset.instanceKey = instanceKey;
        this.setViewKey(tokenEl, this.creatureSelectionKey(group, instanceKey));
        tokenEl.toggleClass("selected", group.selectedInstanceKey === instanceKey);

        // Minions in a squad share the pool: their ring only shows alive or dead
        const ringEl = tokenEl.createEl("div", {cls: "ds-it-token-ring"});
        ringEl.style.setProperty("--ds-it-hp", `${squadMinion && stamina.status !== "dead" ? 1 : stamina.ratio}`);
        this.addImage(ringEl.createEl("div", {cls: "ds-it-token-image"}), creature.image, creature.name);
        if (stamina.status === "dead") {
            setIcon(ringEl.createEl("div", {cls: "ds-it-token-skull"}), "skull");
        }
        ringEl.createEl("div", {cls: "ds-it-token-id", text: `${instance.id}`});

        // Names tell creatures apart at a glance, also without an image
        tokenEl.createEl("div", {cls: "ds-it-token-name", text: creature.name});
        const conditionsEl = tokenEl.createEl("div", {cls: "ds-it-token-conditions"});
        (instance.conditions || []).forEach((entry) => this.renderConditionIcon(conditionsEl, entry));

        if (!squadMinion && stamina.status !== "dead") {
            setStaminaText(tokenEl.createEl("div", {cls: "ds-it-token-stamina"}), stamina);
        }

        // Click to show it in the focus row and the creature view
        tokenEl.addEventListener("click", () => this.focusCreature(group, instanceKey));

        // Double-click (after selecting) or right-click (directly) to edit Stamina;
        // Ctrl+right-click kills this creature
        const viewed: ViewedCreature = {kind: "creature", group, creature, instance};
        tokenEl.addEventListener("dblclick", () => this.openStaminaModal(viewed));
        tokenEl.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!e.ctrlKey) {
                this.openStaminaModal(viewed);
            } else if (this.killCreatureInstance(group, creature, instance)) {
                this.refresh();
            }
        });
        this.onMiddleClick(tokenEl, instance, `${creature.name} #${instance.id}`);
    }

    /**
     * The conditions of a hero or creature: click one to remove it, or the plus to add more. `labeled` shows
     * each condition's name next to its icon.
     */
    private buildConditions(container: HTMLElement, character: Hero | CreatureInstance, name: string, labeled = false): void {
        const conditions = character.conditions || [];
        conditions.forEach((conditionEntry) => {
            const iconEl = this.renderConditionIcon(container, conditionEntry, labeled);
            if (!iconEl) return;
            iconEl.addClass("is-removable");
            iconEl.title = `${iconEl.title} (click to remove)`;
            iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                character.conditions = conditions.filter((entry) => entry !== conditionEntry);
                this.refresh();
            });
        });

        const addEl = container.createEl("button", {cls: "ds-it-add-condition", attr: {"aria-label": "Conditions"}});
        setIcon(addEl, "plus");
        if (labeled && conditions.length === 0) addEl.createSpan({text: "Condition"});
        addEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.openConditions(character, name);
        });
    }

    /** Opens the conditions window of a hero or creature (`name`): each condition on or off, applied together. */
    private openConditions(character: Hero | CreatureInstance, name: string): void {
        new ConditionsModal(this.app, name, character.conditions ?? [], this.conditionManager, (conditions) => {
            character.conditions = conditions;
            this.refresh();
        }).open();
    }

    /**
     * Kills one creature instance. Regular creatures and captains drop to 0 stamina; a minion is marked
     * dead and its stamina is taken out of the squad's pool. Returns false if there was nothing to do.
     */
    private killCreatureInstance(group: EnemyGroup, creature: Creature, instance: CreatureInstance): boolean {
        const label = `${creature.name} #${instance.id}`;
        if (group.is_squad && creature.squad_role === "minion") {
            if (instance.isDead) {
                new Notice(`${label} is already dead.`);
                return false;
            }
            const aliveMinions = creature.instances?.filter((inst) => !inst.isDead).length ?? 0;
            const pool = group.minion_stamina_pool ?? aliveMinions * creature.max_stamina;
            instance.isDead = true;
            group.minion_stamina_pool = Math.max(0, pool - creature.max_stamina);
        } else {
            if ((instance.current_stamina ?? creature.max_stamina) <= 0 && !instance.temp_stamina) {
                new Notice(`${label} is already dead.`);
                return false;
            }
            instance.current_stamina = 0;
            instance.temp_stamina = 0;
        }
        new Notice(`Killed ${label}`);
        return true;
    }

    /** Renders one condition (with its color/effect customizations); null if the condition is unknown. */
    private renderConditionIcon(container: HTMLElement, conditionEntry: string | Condition, labeled = false): HTMLElement | null {
        let conditionKey: string;
        let conditionData: Condition | null = null;
        if (typeof conditionEntry === "string") {
            conditionKey = conditionEntry;
        } else if (typeof conditionEntry === "object" && conditionEntry.key) {
            conditionKey = conditionEntry.key;
            conditionData = conditionEntry;
        } else {
            return null;
        }

        const condition = this.conditionManager.getAnyConditionByKey(conditionKey);
        if (!condition) {
            return null;
        }
        const conditionEl = container.createEl("div", {cls: "ds-it-condition"});
        conditionEl.toggleClass("is-labeled", labeled);
        const iconEl = conditionEl.createSpan({cls: "condition-icon"});
        setIcon(iconEl, condition.iconName);
        if (labeled) conditionEl.createSpan({cls: "ds-it-condition-name", text: condition.displayName});
        conditionEl.title = condition.displayName;

        // Apply color and effect customizations
        if (conditionData) {
            if (conditionData.color) {
                conditionEl.style.setProperty("--ds-it-condition-color", conditionData.color);
                conditionEl.addClass("has-color");
            }
            if (conditionData.effect) {
                iconEl.classList.add(`condition-effect-${conditionData.effect}`);
            }
        }
        return conditionEl;
    }
}
