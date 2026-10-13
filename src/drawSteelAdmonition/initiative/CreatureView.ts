import {MarkdownPostProcessorContext, setIcon} from "obsidian";
import {Featureblock, Statblock} from "steel-compendium-sdk";
import {Creature, CreatureInstance, EnemyGroup, Hero} from "@drawSteelAdmonition/EncounterData";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {StatblockConfig} from "@model/StatblockConfig";
import {FeatureblockConfig} from "@model/FeatureblockConfig";
import {StatblockProcessor} from "@drawSteelAdmonition/statblock/StatblockProcessor";
import {FeatureblockView} from "@drawSteelAdmonition/featureblock/FeatureblockView";
import {HeroKit, HeroSheet, HeroSheetStore, initHeroSheet, isHeroSheet, resolveKits} from "@drawSteelAdmonition/hero/HeroSheet";
import {HeroSheetView} from "@drawSteelAdmonition/hero/HeroSheetView";
import DrawSteelAdmonitionPlugin from "main";

/** The hero or creature instance shown in the creature view. */
export type ViewedCreature =
    | { kind: "hero"; hero: Hero }
    | { kind: "creature"; group: EnemyGroup; creature: Creature; instance: CreatureInstance };

interface StatblockEntry {
    data?: any;
    error?: string;
    filePath?: string;
    kits?: HeroKit[]; // For a hero sheet: its resolved kits
    stale?: boolean; // Its note changed; still shown until it has been re-read
}

/**
 * Resolved statblock notes, keyed by reference. Kept so the creature view renders synchronously when the
 * tracker re-renders after each change; an entry is dropped when its note is modified.
 */
export class StatblockCache {
    private entries = new Map<string, StatblockEntry>();
    private loading = new Map<string, Promise<StatblockEntry>>();

    constructor(private plugin: DrawSteelAdmonitionPlugin) {
        const vault = plugin.app.vault;
        plugin.registerEvent(vault.on("modify", (file) => this.markStale(file.path)));
        plugin.registerEvent(vault.on("delete", (file) => this.dropFile(file.path)));
        // A missing note may have been created or renamed into place
        plugin.registerEvent(vault.on("create", () => this.dropErrors()));
        plugin.registerEvent(vault.on("rename", (file, oldPath) => {
            this.dropFile(oldPath);
            this.dropErrors();
        }));
    }

    public peek(ref: string): StatblockEntry | undefined {
        return this.entries.get(ref);
    }

    public load(ref: string): Promise<StatblockEntry> {
        const cached = this.entries.get(ref);
        if (cached && !cached.stale) return Promise.resolve(cached);
        let pending = this.loading.get(ref);
        if (!pending) {
            pending = this.resolve(ref).then((entry) => {
                this.entries.set(ref, entry);
                this.loading.delete(ref);
                return entry;
            });
            this.loading.set(ref, pending);
        }
        return pending;
    }

    private async resolve(ref: string): Promise<StatblockEntry> {
        const resolver = new ReferenceResolver(this.plugin.app, this.plugin.settings);
        const file = resolver.resolveFile(ref);
        if (!file) {
            return {error: `Statblock note '${ReferenceResolver.referencePath(ref)}' not found.`};
        }
        try {
            const data = await resolver.resolvePath(file.path);
            const kits = isHeroSheet(data) ? await resolveKits(this.plugin.app, resolver, data) : undefined;
            return {data, filePath: file.path, kits};
        } catch (e) {
            return {error: e.message, filePath: file.path};
        }
    }

    /** Keeps showing an edited note's last version (no "Loading" flash) until load() re-reads it. */
    private markStale(path: string): void {
        this.entries.forEach((entry) => {
            if (entry.filePath === path || entry.kits?.some((kit) => kit.path === path)) entry.stale = true;
        });
    }

    private dropFile(path: string): void {
        this.entries.forEach((entry, ref) => {
            if (entry.filePath === path || entry.kits?.some((kit) => kit.path === path)) this.entries.delete(ref);
        });
    }

    private dropErrors(): void {
        this.entries.forEach((entry, ref) => {
            if (entry.error) this.entries.delete(ref);
        });
    }
}

// Fields of a hero sheet the tracker changes; the rendered sheet doesn't show them (the stamina stat is bound
// to the tracker), so a change to them alone keeps the rendered body
const TRACKER_STATE_KEYS = ["current_stamina", "temp_stamina", "current_recoveries"];
// Counters shown on a hero sheet's body, compared with what the kept body shows
const COUNTER_KEYS = ["resource", "surges", "victories"] as const;

/** The last rendered statblock body per note, reused while the same statblock is shown so updates don't flash. */
interface RenderedBody {
    key: string;
    el: HTMLElement;
    sheet?: HeroSheet; // For a hero sheet: the sheet the body shows (its counters change in place)
}

const renderedBodies = new Map<string, RenderedBody>();

/** Identifies what a body shows: the selected hero/creature and the statblock content (minus tracker state). */
function bodyKey(viewed: ViewedCreature, data: any, entry?: StatblockEntry): string {
    const who = viewed.kind === "hero"
        ? `hero:${viewed.hero.name}`
        : `creature:${viewed.group.name}:${viewed.creature.name}:${viewed.instance.id}`;
    const content = data && typeof data === "object" ? {...data} : data;
    if (content && typeof content === "object") {
        TRACKER_STATE_KEYS.forEach((key) => delete content[key]);
        COUNTER_KEYS.forEach((key) => delete content[key]);
    }
    return JSON.stringify([who, content, entry?.error, entry?.filePath, entry?.kits]);
}

/**
 * The panel next to the initiative tracker showing the selected hero or creature: a summary (built by the
 * tracker, which owns stamina and condition rendering) followed by its statblock with stats and abilities.
 */
/** What the creature view needs from the tracker, which owns stamina, conditions and the selection. */
export interface CreatureViewHooks {
    // Portrait, name, conditions and stamina at the top of the view
    buildSummary: (container: HTMLElement, viewed: ViewedCreature) => void;
    // Shows the current stamina in an element and makes clicking it edit the stamina, like in the tracker
    bindStamina: (staminaEl: HTMLElement, viewed: ViewedCreature) => void;
    onClose: () => void;
    // Shows the next (1) or previous (-1) hero, or creature of the same group
    onStep: (step: number) => void;
    // How many heroes, or creatures in the group, onStep goes through
    siblingCount: (viewed: ViewedCreature) => number;
}

/**
 * The panel next to the initiative tracker showing the selected hero or creature: a summary (built by the
 * tracker) followed by its statblock with stats and abilities.
 */
export class CreatureView {
    // Guards against a slow statblock load rendering into a panel that has since moved on
    private renderToken = 0;

    constructor(
        private plugin: DrawSteelAdmonitionPlugin,
        private statblocks: StatblockCache,
        private ctx: MarkdownPostProcessorContext,
        private hooks: CreatureViewHooks,
    ) {
    }

    public render(container: HTMLElement, viewed: ViewedCreature | null): void {
        const token = ++this.renderToken;
        container.empty();

        if (!viewed) {
            container.addClass("is-empty");
            const placeholderEl = container.createEl("div", {cls: "ds-init-view-placeholder"});
            setIcon(placeholderEl.createEl("div", {cls: "ds-init-view-placeholder-icon"}), "scroll");
            placeholderEl.createEl("div", {cls: "ds-init-view-placeholder-title", text: "Nothing selected"});
            placeholderEl.createEl("div", {text: "Click a hero or creature in the tracker to see its stats and abilities here."});
            return;
        }
        container.removeClass("is-empty");

        const header = container.createEl("div", {cls: `ds-init-view-header is-${viewed.kind}`});
        this.hooks.buildSummary(header.createEl("div", {cls: "ds-init-view-summary"}), viewed);
        this.buildControls(header.createEl("div", {cls: "ds-cv-controls"}), viewed);

        const statblock = viewed.kind === "hero" ? viewed.hero.statblock : viewed.creature.statblock;

        if (statblock == null) {
            container.createEl("div", {cls: "ds-init-view-body"}).createEl("div", {
                cls: "ds-init-view-message",
                text: "No statblock linked. Add `statblock: [[Note]]` to show stats and abilities here.",
            });
        } else if (typeof statblock !== "string") {
            // Inline statblock in the tracker's YAML
            this.showBody(container, viewed, statblock);
        } else {
            const cached = this.statblocks.peek(statblock);
            if (cached) {
                this.showBody(container, viewed, cached.data, cached);
            } else {
                container.createEl("div", {cls: "ds-init-view-body"})
                    .createEl("div", {cls: "ds-init-view-message", text: "Loading statblock…"});
            }
            if (!cached || cached.stale) {
                this.statblocks.load(statblock).then((entry) => {
                    if (token !== this.renderToken) return;
                    this.showBody(container, viewed, entry.data, entry);
                });
            }
        }
    }

    /** Previous / next hero or creature of the group, and close. */
    private buildControls(container: HTMLElement, viewed: ViewedCreature): void {
        const button = (icon: string, label: string, onClick: () => void) => {
            const buttonEl = container.createEl("button", {cls: "ds-it-icon-button", attr: {"aria-label": label}});
            setIcon(buttonEl, icon);
            buttonEl.addEventListener("click", onClick);
        };
        if (this.hooks.siblingCount(viewed) > 1) {
            const what = viewed.kind === "hero" ? "hero" : "creature in the group";
            button("chevron-left", `Previous ${what}`, () => this.hooks.onStep(-1));
            button("chevron-right", `Next ${what}`, () => this.hooks.onStep(1));
        }
        button("x", "Close", () => this.hooks.onClose());
    }

    /**
     * Shows the statblock body: the one already rendered if it shows the same thing (moved into the new panel,
     * so a re-render after every stamina change doesn't flash), otherwise a freshly rendered one.
     */
    private showBody(container: HTMLElement, viewed: ViewedCreature, data: any, entry?: StatblockEntry): void {
        const path = this.ctx.sourcePath;
        const key = bodyKey(viewed, data, entry);
        const previous = renderedBodies.get(path);
        const existing = container.querySelector<HTMLElement>(":scope > .ds-init-view-body");

        let body: HTMLElement;
        if (previous && previous.key === key && this.countersMatch(previous, data)) {
            body = previous.el;
            if (existing && existing !== body) existing.replaceWith(body);
            else if (!existing) container.appendChild(body);
        } else {
            body = createDiv({cls: "ds-init-view-body"});
            const sheet = entry?.error ? undefined : this.renderBlock(body, data, entry?.filePath, entry?.kits);
            if (entry?.error) {
                body.createEl("div", {cls: "ds-init-view-message error-message", text: entry.error});
            }
            if (existing) existing.replaceWith(body);
            else container.appendChild(body);
            renderedBodies.set(path, {key, el: body, sheet});
        }
        this.bindStatsStamina(body, viewed);
    }

    /** A kept hero sheet body still shows the sheet's resource, surges and victories (changed elsewhere?). */
    private countersMatch(previous: RenderedBody, data: any): boolean {
        if (!previous.sheet) return true;
        return COUNTER_KEYS.every((key) => (previous.sheet![key] ?? 0) === (data?.[key] ?? 0));
    }

    /**
     * The statblock's Stamina stat shows the max stamina; in the view it shows this hero's or creature's
     * current/max stamina instead and opens the stamina window when clicked.
     */
    private bindStatsStamina(body: HTMLElement, viewed: ViewedCreature): void {
        body.querySelectorAll<HTMLElement>(".ds-sb-stats-item").forEach((item) => {
            if (item.querySelector(".ds-sb-stats-item-bottom")?.textContent !== "Stamina") return;
            const oldValueEl = item.querySelector<HTMLElement>(".ds-sb-stats-item-top");
            if (!oldValueEl) return;
            // A kept body still has the previous render's click handler: replace the element to drop it
            const valueEl = createDiv({cls: "ds-sb-stats-item-top"});
            oldValueEl.replaceWith(valueEl);
            this.hooks.bindStamina(valueEl, viewed);
            if (item.hasClass("ds-init-view-stats-stamina")) return;
            item.addClass("ds-init-view-stats-stamina");
            // The whole stat (value and label) is the click target
            item.addEventListener("click", (e) => {
                const current = item.querySelector<HTMLElement>(".ds-sb-stats-item-top");
                if (current && e.target !== current) current.click();
            });
        });
    }

    /**
     * A linked ds-hero note: its stats and abilities, with the heroic resource, surges and victories editable
     * (saved to the note). Stamina and recoveries are in the summary above, edited from the tracker.
     */
    private renderHeroSheet(container: HTMLElement, raw: any, filePath?: string, kits?: HeroKit[]): HeroSheet {
        const blockEl = container.createEl("div", {cls: "ds-hero-container ds-sb-container ds-container"});
        // The cached copy is shared between renders; the view edits its own
        const sheet = initHeroSheet(structuredClone(raw), kits);
        new HeroSheetView(this.plugin, sheet, this.ctx, {
            showStamina: false,
            onChange: (state) => {
                if (filePath) HeroSheetStore.saveState(this.plugin.app, filePath, state);
            },
        }).build(blockEl);
        return sheet;
    }

    /** Renders a statblock or featureblock DTO, as written in a ds-statblock / ds-featureblock code block. */
    private renderBlock(container: HTMLElement, raw: any, filePath?: string, kits?: HeroKit[]): HeroSheet | undefined {
        try {
            if (isHeroSheet(raw)) {
                return this.renderHeroSheet(container, raw, filePath, kits);
            } else if (raw?.type === "featureblock") {
                const blockEl = container.createEl("div", {cls: "ds-fb-container ds-container"});
                const config = new FeatureblockConfig(Featureblock.modelDTOAdapter(raw));
                new FeatureblockView(this.plugin, config, this.ctx).build(blockEl);
            } else if (raw?.type === "statblock" || raw?.might != null || raw?.features) {
                const blockEl = container.createEl("div", {cls: "ds-sb-container ds-container"});
                const config = new StatblockConfig(Statblock.modelDTOAdapter(raw));
                StatblockProcessor.render(this.plugin, blockEl, config, this.ctx);
            } else {
                container.createEl("div", {
                    cls: "ds-init-view-message",
                    text: "The linked note has no statblock with stats or abilities.",
                });
            }
        } catch (e) {
            container.empty();
            container.createEl("div", {
                cls: "ds-init-view-message error-message",
                text: `Couldn't render the statblock: ${e.message}`,
            });
        }
    }
}
