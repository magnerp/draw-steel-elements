import {App, MarkdownPostProcessorContext, Notice, setIcon} from "obsidian";
import {RecoveryInfo, StaminaEditModal} from "@views/StaminaEditModal";
import {ConditionManager} from "@utils/Conditions";
import {AddConditionsModal} from "@views/ConditionSelectModal";
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

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const MIN_HEIGHT = 200;

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

    constructor(
        services: TrackerServices,
        readonly root: HTMLElement,
        private data: EncounterData,
        private ctx: MarkdownPostProcessorContext,
    ) {
        this.plugin = services.plugin;
        this.app = services.plugin.app;
        this.conditionManager = services.conditionManager;
        this.creatureView = new CreatureView(
            this.plugin,
            services.statblocks,
            ctx,
            (el, viewed) => this.buildViewSummary(el, viewed),
            () => this.select(null),
            (el, viewed) => this.bindViewStamina(el, viewed),
        );
    }

    /** Adds a creature's or hero's image, at once if its source was resolved before. */
    private addImage(container: HTMLElement, imageRaw: string | null | undefined, alt: string): void {
        const defaultPath = this.plugin.settings.defaultImagePath;
        const cacheKey = `${imageRaw ?? ""}\n${defaultPath}`;
        const known = imageSources.get(cacheKey);
        if (known) {
            container.createEl("img", {attr: {src: known, alt}});
            return;
        }
        Images.resolveImageSourceOrDefault(this.app, imageRaw ?? null, defaultPath).then((imgSrc) => {
            imageSources.set(cacheKey, imgSrc);
            container.createEl("img", {attr: {src: imgSrc, alt}});
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
        const layout = this.root.createEl("div", {cls: "ds-init-layout"});
        this.trackerEl = layout.createEl("div", {cls: "ds-init-tracker"});
        const splitter = layout.createEl("div", {
            cls: "ds-init-resizer ds-init-splitter",
            attr: {title: "Drag to resize the tracker and creature view"},
        });
        this.viewEl = layout.createEl("div", {cls: "ds-init-view"});
        const heightHandle = this.root.createEl("div", {
            cls: "ds-init-resizer ds-init-height-handle",
            attr: {title: "Drag to change the height"},
        });
        this.applyLayout(layout);
        this.makeResizable(layout, splitter, heightHandle);

        this.trackerEl.addEventListener("scroll", () => trackerScroll.set(this.ctx.sourcePath, this.trackerEl.scrollTop));
        this.viewEl.addEventListener("scroll", () => viewScroll.set(this.ctx.sourcePath, this.viewEl.scrollTop));

        this.buildTracker(this.trackerEl);
        this.renderView();
        this.restoreScroll();
    }

    /**
     * Restores the tracker's and view's scroll positions. When Obsidian re-renders the block (after every save,
     * e.g. selecting a creature) it isn't in the page yet, and a detached element ignores scrollTop. A mutation
     * observer restores it as soon as the block is attached, before the page is painted (no jump).
     */
    private restoreScroll(): void {
        const trackerEl = this.trackerEl;
        const viewEl = this.viewEl;
        const restore = () => {
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

    /** Image, name, stamina and conditions at the top of the creature view (display only). */
    private buildViewSummary(container: HTMLElement, viewed: ViewedCreature): void {
        const name = viewed.kind === "hero" ? viewed.hero.name : `${viewed.creature.name} #${viewed.instance.id}`;
        const image = viewed.kind === "hero" ? viewed.hero.image : viewed.creature.image;

        const imageEl = container.createEl("div", {cls: "character-image"});
        this.addImage(imageEl, image ?? null, name);

        const infoEl = container.createEl("div", {cls: "character-info"});
        infoEl.createEl("div", {cls: "character-name", text: name});
        if (viewed.kind === "creature" && viewed.group.name !== viewed.creature.name) {
            infoEl.createEl("div", {cls: "ds-init-view-group", text: viewed.group.name});
        }
        const conditionsEl = infoEl.createEl("div", {cls: "character-conditions"});
        const conditions = viewed.kind === "hero" ? viewed.hero.conditions : viewed.instance.conditions;
        (conditions || []).forEach((entry) => this.renderConditionIcon(conditionsEl, entry));

        const healthEl = container.createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina ds-init-view-stamina"});
        if (viewed.kind === "hero") {
            this.updateStaminaDisplay(staminaEl, viewed.hero);
            const recoveries = this.recoveryInfo(viewed.hero);
            if (recoveries) {
                healthEl.createEl("div", {
                    cls: "ds-init-view-recoveries",
                    text: `Recoveries ${recoveries.current}/${recoveries.max}`,
                });
            }
        } else {
            this.updateStaminaDisplay(staminaEl, viewed.instance, viewed.creature, viewed.group);
        }
        staminaEl.title = "Edit Stamina";
        staminaEl.addEventListener("click", () => this.openViewStaminaModal(viewed));
    }

    /** Shows the viewed hero's or creature's stamina in `el` (the statblock's Stamina stat); clicking edits it. */
    private bindViewStamina(el: HTMLElement, viewed: ViewedCreature): void {
        if (viewed.kind === "hero") {
            this.updateStaminaDisplay(el, viewed.hero);
        } else {
            this.updateStaminaDisplay(el, viewed.instance, viewed.creature, viewed.group);
        }
        const title = el.title;
        el.parentElement?.setAttr("title", title ? `${title}. Click to edit Stamina` : "Edit Stamina");
        el.title = "";
        el.addEventListener("click", () => this.openViewStaminaModal(viewed));
    }

    /**
     * The same stamina window as clicking the stamina in the tracker. The whole tracker re-renders afterwards so
     * the tracker row, grid cell and creature view all show the new stamina.
     */
    private openViewStaminaModal(viewed: ViewedCreature): void {
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
            // Minions in a squad share the pool's stamina
            new MinionStaminaPoolModal(this.app, group, creature, this.data, this.ctx, () => {
                this.render();
                this.save();
            }).open();
            return;
        }
        const staminaBar = StaminaBar.fromCreature(instance, creature);
        new StaminaEditModal(this.app, staminaBar, false, creature.name, () => {
            staminaBar.updateCreature(instance);
            this.render();
            this.save();
        }, creature.squad_role !== "minion").open();
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
                    this.openViewStaminaModal(viewed);
                } else if (viewed.kind === "hero") {
                    new Notice("Only creatures can be killed with the shortcut.");
                } else if (this.killCreatureInstance(viewed.group, viewed.creature, viewed.instance)) {
                    this.render();
                    this.save();
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
            const instanceKey = keys[(index + step + keys.length) % keys.length];
            // The group's detail row follows the selection, as when clicking a cell
            group.selectedInstanceKey = instanceKey;
            selections.set(this.ctx.sourcePath, {kind: "creature", groupIndex: selection.groupIndex, instanceKey});
            viewScroll.delete(this.ctx.sourcePath);
            this.render();
            this.save();
        }
        this.scrollToSelection();
    }

    /**
     * Moves the selection to the next (`step` 1) or previous (-1) group, wrapping around: the heroes come first,
     * then each enemy group. An enemy group selects the creature in its detail row, as clicking the group does;
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

    /** Scrolls the tracker so the selected row or cell is visible, and remembers it for the next render. */
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
        this.render();
        this.save();
    }

    // ---------------------------------------------------------------------------------------------
    // Tracker
    // ---------------------------------------------------------------------------------------------

    private buildTracker(container: HTMLElement): void {
        const data = this.data;
        const topActionBar = container.createEl("div", {cls: "top-action-bar"});

        // Reset Round Button
        const resetRoundButton = topActionBar.createEl("button", {
            text: "Reset Round",
            cls: "reset-round-button",
        });
        resetRoundButton.addEventListener("click", () => this.resetRound());

        // Reset Encounter Button
        const resetEncounterButton = topActionBar.createEl("button", {
            text: "Reset Encounter State",
            cls: "reset-encounter-button",
        });
        resetEncounterButton.addEventListener("click", () => {
            new ResetEncounterModal(this.app, () => {
                resetEncounter(data);
                this.save();
            }).open();
        });

        // Add Enemy Group Button
        const addGroupButton = topActionBar.createEl("button", {
            text: "Add Enemy Group",
            cls: "add-enemy-group-button",
        });
        addGroupButton.addEventListener("click", () => {
            new AddEnemyGroupModal(this.app, this.plugin.settings, async (group) => {
                // Same setup as groups written in the YAML (statblocks, minion squads, instances)
                const resolver = new ReferenceResolver(this.app, this.plugin.settings);
                await initEnemyGroup(group, data.enemy_groups.length, resolver);
                data.enemy_groups.push(group);
                this.render();
                await this.save();
            }).open();
        });

        // Heroes UI
        const heroesContainer = container.createEl("div", {cls: "heroes-container"});
        const heroesHeader = heroesContainer.createEl("div", {cls: "heroes-header"});
        heroesHeader.createEl("h3", {text: "Heroes"});
        if (data.party) {
            heroesHeader.createEl("span", {
                cls: "party-link-tag",
                text: `Party: ${data.party.replace(/^\[\[|\]\]$/g, "")}`,
                attr: {title: "Stamina and Recoveries of party heroes are shared with every encounter using this party"},
            });
        }

        data.heroes.forEach((hero) => {
            const heroContEl = heroesContainer.createEl("div", {cls: "hero-container"});
            this.buildCharacterRow(heroContEl, hero);
        });

        // Enemies UI
        const enemiesContainer = container.createEl("div", {cls: "enemies-container"});
        const enemyHeader = enemiesContainer.createEl("div", {cls: "enemies-header"});
        enemyHeader.createEl("h3", {text: "Enemy Groups"});

        // Villain Power
        const maliceContainer = enemyHeader.createEl("div", {cls: "malice-container"});
        const maliceModifiers = maliceContainer.createEl("div", {cls: "malice-modifiers"});
        let maliceUp = maliceModifiers.createEl("div", {cls: "malice-modifier"});
        let maliceDown = maliceModifiers.createEl("div", {cls: "malice-modifier"});
        maliceContainer.createEl("div", {cls: "malice-text", text: "Malice: " + data.malice.value});

        setIcon(maliceUp, "chevron-up");
        setIcon(maliceDown, "chevron-down");

        maliceUp.addEventListener("click", () => {
            data.malice.value += 1;
            maliceContainer.setText("Malice: " + data.malice.value);
            this.save();
        });
        maliceDown.addEventListener("click", () => {
            data.malice.value -= 1;
            maliceContainer.setText("Malice: " + data.malice.value);
            this.save();
        });

        data.enemy_groups.forEach((group) => {
            const groupContEl = enemiesContainer.createEl("div", {cls: "enemy-group-container"});
            this.buildEnemyGroupRow(groupContEl, group);
        });
    }

    private buildCharacterRow(container: HTMLElement, character: Hero): void {
        // Left icons
        const icon = container.createEl("div", {cls: "character-icon"});

        // Turn Indicator
        const turnIndicatorEl = icon.createEl("div", {cls: "turn-indicator"});
        turnIndicatorEl.title = "Toggle to mark turn taken";
        this.updateTurnIndicator(turnIndicatorEl, character.has_taken_turn ?? false);

        // Add click handler to toggle has_taken_turn
        turnIndicatorEl.addEventListener("click", () => {
            character.has_taken_turn = !(character.has_taken_turn ?? false);
            this.updateTurnIndicator(turnIndicatorEl, character.has_taken_turn);
            this.save();
        });

        const rowEl = container.createEl("div", {cls: "character-row"});

        // Click to show this hero in the creature view
        this.setViewKey(rowEl, this.heroSelectionKey(character));
        rowEl.addEventListener("click", () => this.selectHero(character));

        // Middle-click to add conditions to this hero
        rowEl.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.openAddConditions(character, () => {
                container.empty();
                this.buildCharacterRow(container, character);
                this.save();
            });
        });

        // Character Image
        const imageEl = rowEl.createEl("div", {cls: "character-image"});
        const imgSrcRaw = character.image ?? null;

        this.addImage(imageEl, imgSrcRaw, character.name);

        // Middle: Character Info
        const infoEl = rowEl.createEl("div", {cls: "character-info"});

        // Top: Character Name
        infoEl.createEl("div", {cls: "character-name", text: character.name});

        // Bottom: Conditions
        const conditionsEl = infoEl.createEl("div", {cls: "character-conditions"});
        this.buildConditionIcons(conditionsEl, character);

        // Right: Health Info and Turn Indicator Container
        const rightContainer = rowEl.createEl("div", {cls: "character-right"});

        // Health Info
        const healthEl = rightContainer.createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});
        this.updateStaminaDisplay(staminaEl, character);

        staminaEl.addEventListener("click", () => {
            let staminaBar = StaminaBar.fromHero(character);
            const modal = new StaminaEditModal(this.app, staminaBar, true, character.name, (result) => {
                staminaBar.updateHero(character);
                if (character.max_recoveries != null) {
                    character.current_recoveries = (character.current_recoveries ?? character.max_recoveries) - result.recoveriesSpent;
                }
                // Recoveries display is rebuilt along with the row
                container.empty();
                this.buildCharacterRow(container, character);
                this.saveHeroStamina(character);
            }, true, this.recoveryInfo(character));
            modal.open();
        });

        buildRecoveryControl(healthEl, character, () => this.saveHeroStamina(character));
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

    /** The instance shown in a group's detail row: the last selected one, else the first. */
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

    private buildEnemyGroupRow(container: HTMLElement, group: EnemyGroup): void {
        const data = this.data;

        // Left icons
        const icon = container.createEl("div", {cls: "enemy-group-icon"});

        // Turn Indicator
        const turnIndicatorEl = icon.createEl("div", {cls: "turn-indicator"});
        turnIndicatorEl.title = "Toggle to mark turn taken";
        this.updateTurnIndicator(turnIndicatorEl, group.has_taken_turn ?? false);

        turnIndicatorEl.addEventListener("click", () => {
            group.has_taken_turn = !(group.has_taken_turn ?? false);
            this.updateTurnIndicator(turnIndicatorEl, group.has_taken_turn);
            this.save();
        });

        const groupEl = container.createEl("div", {cls: "enemy-group"});

        // Clicking anywhere else on the group shows the creature in its detail row (the only one, or the
        // last selected); cells and the detail row select their own creature
        groupEl.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).closest(".creature-instance-cell, .creature-detail-row, .remove-group-btn")) return;
            const shown = this.shownInstance(group);
            if (shown) {
                this.selectCreature(group, `${group.creatures.indexOf(shown.creature)}-${shown.instance.id}`);
            }
        });

        // Group Header with Name and Turn Indicator
        const groupHeader = groupEl.createEl("div", {cls: "group-header"});
        groupHeader.createEl("h4", {text: group.name});

        // Remove the whole group from the encounter
        const removeGroupEl = groupHeader.createEl("div", {cls: "remove-group-btn"});
        setIcon(removeGroupEl, "trash-2");
        removeGroupEl.title = "Remove group from encounter";
        removeGroupEl.addEventListener("click", () => {
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
                    this.render();
                    this.save();
                }
            ).open();
        });

        // Detailed Creature Row Container
        const detailRowContainer = groupEl.createEl("div", {cls: "creature-detail-row"});

        const selectedInstance = this.shownInstance(group);

        if (selectedInstance) {
            this.buildDetailedCreatureRow(detailRowContainer, selectedInstance.creature, selectedInstance.instance, group);
        }

        // If the enemy group contains a single creature, no need for a grid
        if (group.creatures.length === 1 && group.creatures[0].amount === 1) {
            return;
        }

        const rebuildGroup = () => {
            container.empty();
            this.buildEnemyGroupRow(container, group);
            this.save();
        };

        // Grid of Creature Instances
        const instancesGrid = groupEl.createEl("div", {cls: "creature-instances-grid"});

        // Create cells for all instances of all creatures in the group
        group.creatures.forEach((creature, creatureIndex) => {
            creature.instances?.forEach((instance) => {
                const cellEl = instancesGrid.createEl("div", {cls: "creature-instance-cell"});

                const instanceKey = `${creatureIndex}-${instance.id}`;
                cellEl.dataset.instanceKey = instanceKey;
                this.setViewKey(cellEl, this.creatureSelectionKey(group, instanceKey));

                // Handle selection highlighting
                if (group.selectedInstanceKey === instanceKey) {
                    cellEl.addClass("selected");
                }

                // Display creature image in the cell
                const imgEl = cellEl.createEl("div", {cls: "instance-image"});
                const imgSrcRaw = creature.image ?? null;
                this.addImage(imgEl, imgSrcRaw, creature.name);

                // Name below the image, so creatures sharing a token can be told apart
                cellEl.createEl("div", {cls: "instance-name", text: creature.name})
                    .title = `${creature.name} #${instance.id}`;

                // Conditions of this instance, below the image (display only; edit them in the detail row)
                const cellConditionsEl = cellEl.createEl("div", {cls: "instance-conditions"});
                this.buildInstanceConditionIcons(cellConditionsEl, instance);

                // Display health status below the image
                const staminaEl = cellEl.createEl("div", {cls: "instance-stamina"});
                this.updateStaminaDisplay(staminaEl, instance, creature, group);

                // Click to update the detail row and show the creature in the creature view
                cellEl.addEventListener("click", () => {
                    instancesGrid.querySelectorAll(".creature-instance-cell").forEach((cell) => {
                        cell.removeClass("selected");
                    });
                    cellEl.addClass("selected");

                    detailRowContainer.empty();
                    this.buildDetailedCreatureRow(detailRowContainer, creature, instance, group);
                    this.selectCreature(group, instanceKey);

                    // Persist the selected instance key
                    group.selectedInstanceKey = instanceKey;
                    this.save();
                });

                const openStaminaModal = () => {
                    if (group.is_squad && creature.squad_role === "minion") {
                        new MinionStaminaPoolModal(this.app, group, creature, data, this.ctx, rebuildGroup).open();
                    } else {
                        this.editCreatureStaminaModal(instance, creature, staminaEl, container).open();
                    }
                };

                // Double-click (after selecting) or right-click (directly) to edit STAMINA;
                // Ctrl+right-click kills this creature
                cellEl.addEventListener("dblclick", openStaminaModal);
                cellEl.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.ctrlKey) {
                        if (this.killCreatureInstance(group, creature, instance)) {
                            rebuildGroup();
                        }
                    } else {
                        openStaminaModal();
                    }
                });

                // Middle-click to add conditions to this creature (regardless of the selection)
                cellEl.addEventListener("auxclick", (e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.openAddConditions(instance, rebuildGroup);
                });
            });
        });
    }

    private buildDetailedCreatureRow(
        container: HTMLElement,
        creature: Creature,
        instance: CreatureInstance,
        group: EnemyGroup
    ): void {
        container.addClass("character-row");

        // Click to show this creature in the creature view
        const instanceKey = `${group.creatures.indexOf(creature)}-${instance.id}`;
        this.setViewKey(container, this.creatureSelectionKey(group, instanceKey));
        container.onclick = () => this.selectCreature(group, instanceKey);

        // Left: Creature Image
        const imageEl = container.createEl("div", {cls: "character-image"});
        const imgSrcRaw = creature.image ?? null;
        this.addImage(imageEl, imgSrcRaw, creature.name);

        // Middle: Creature Info
        const infoEl = container.createEl("div", {cls: "character-info"});

        // Top: Creature Name (include instance ID)
        infoEl.createEl("div", {cls: "character-name", text: `${creature.name} #${instance.id}`});

        // Bottom: Conditions
        const conditionsEl = infoEl.createEl("div", {cls: "character-conditions"});
        this.buildConditionIcons(conditionsEl, instance, () => {
            const cellConditionsEl = container.parentElement?.querySelector(
                `.creature-instance-cell[data-instance-key="${instanceKey}"] .instance-conditions`
            );
            if (cellConditionsEl instanceof HTMLElement) {
                cellConditionsEl.empty();
                this.buildInstanceConditionIcons(cellConditionsEl, instance);
            }
        });

        // Right: Health Info
        const healthEl = container.createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});
        this.updateStaminaDisplay(staminaEl, instance, creature, group);

        if (group.is_squad && creature.squad_role === "minion") {
            // For minions in a squad, edit the pool stamina
            staminaEl.addEventListener("click", () => {
                new MinionStaminaPoolModal(this.app, group, creature, this.data, this.ctx, () => {
                    container.empty();
                    this.buildDetailedCreatureRow(container, creature, instance, group);
                    this.save();
                }).open();
            });
        } else {
            // For normal creatures and captains
            staminaEl.addEventListener("click", () => {
                this.editCreatureStaminaModal(instance, creature, staminaEl, container).open();
            });
        }
    }

    private editCreatureStaminaModal(
        instance: CreatureInstance,
        creature: Creature,
        staminaEl: HTMLElement,
        container: HTMLElement
    ) {
        const staminaBar = StaminaBar.fromCreature(instance, creature);
        const showWinded = creature.squad_role !== "minion";
        return new StaminaEditModal(this.app, staminaBar, false, creature.name, () => {
            staminaBar.updateCreature(instance);
            this.updateStaminaDisplay(staminaEl, instance, creature);
            this.save();

            // Update the STAMINA in the grid cell as well
            const gridCell = container.parentElement?.querySelector(
                `.creature-instance-cell:nth-child(${instance.id}) .instance-stamina`
            );
            if (gridCell) {
                this.updateStaminaDisplay(gridCell as HTMLElement, instance, creature);
            }
        }, showWinded);
    }

    private updateTurnIndicator(el: HTMLElement, hasTakenTurn: boolean): void {
        el.empty();
        if (hasTakenTurn) {
            el.addClass("taken-turn");
            setIcon(el, "check");
        } else {
            el.removeClass("taken-turn");
            setIcon(el, "dot");
        }
    }

    private updateStaminaDisplay(
        staminaEl: HTMLElement,
        character: Hero | CreatureInstance,
        creature?: Creature,
        group?: EnemyGroup
    ): void {
        if (group?.is_squad && creature?.squad_role === "minion") {
            // For minions in squads, display the minion stamina pool or DEAD
            if ((character as CreatureInstance).isDead) {
                staminaEl.textContent = `DEAD`;
                staminaEl.style.color = 'crimson';
            } else {
                const currentStamina = group.minion_stamina_pool ?? 0;
                staminaEl.textContent = `${currentStamina}/${creature.max_stamina * creature.amount} (${creature.max_stamina})`;
                staminaEl.style.color = 'var(--text-normal)';
            }
        } else {
            const currentStamina = character.current_stamina ?? 0;
            const tempStamina = character.temp_stamina ?? 0;
            const maxStamina = this.isHero(character)
                ? (character as Hero).max_stamina
                : creature?.max_stamina ?? 0;

            // Creatures other than heroes die at 0 stamina, shown like a dead minion
            if (!this.isHero(character) && currentStamina <= 0 && tempStamina <= 0) {
                staminaEl.textContent = `DEAD`;
                staminaEl.style.color = 'crimson';
                staminaEl.removeClass("is-winded");
                staminaEl.title = "";
                return;
            }

            let displayText = `${currentStamina}`;
            if (tempStamina > 0) {
                displayText += `(+${tempStamina})`;
            }
            displayText += `/${maxStamina}`;

            staminaEl.textContent = displayText;

            if (currentStamina < 0) {
                staminaEl.style.color = "red";
            } else if (tempStamina > 0) {
                staminaEl.style.color = "green";
            } else {
                staminaEl.style.color = "";
            }

            // Winded: at or below half of max stamina (heroes and enemies, but not minions)
            const winded = creature?.squad_role !== "minion" && Stamina.isWinded(currentStamina, maxStamina);
            staminaEl.toggleClass("is-winded", winded);
            staminaEl.title = winded ? `Winded (half of ${maxStamina} stamina is ${Stamina.windedThreshold(maxStamina)})` : "";
            if (winded && staminaEl.hasClass("character-stamina")) {
                staminaEl.createEl("span", {cls: "stamina-winded-tag", text: "Winded"});
            }

            // Dying (0 or less) / Dead (negative half of max) only apply to heroes
            if (this.isHero(character) && staminaEl.hasClass("character-stamina")) {
                this.addDyingTag(staminaEl, currentStamina, maxStamina);
            }
        }
    }

    private addDyingTag(staminaEl: HTMLElement, currentStamina: number, maxStamina: number): void {
        const status = Stamina.status(currentStamina, maxStamina, true);
        if (status === "dying" || status === "dead") {
            staminaEl.createEl("span", {cls: "stamina-dying-tag", text: status === "dying" ? "Dying" : "Dead"});
            staminaEl.title = status === "dying"
                ? `Dying (dead at ${Stamina.minimumStamina(maxStamina, true)})`
                : "Dead";
        }
    }

    private buildConditionIcons(
        container: HTMLElement,
        character: Hero | CreatureInstance,
        onChange?: () => void
    ): void {
        const conditions = character.conditions || [];

        conditions.forEach((conditionEntry) => {
            const iconEl = this.renderConditionIcon(container, conditionEntry);
            iconEl?.addEventListener("click", () => {
                character.conditions = conditions.filter((entry) => entry !== conditionEntry);
                container.empty();
                this.buildConditionIcons(container, character, onChange);
                onChange?.();
                this.save();
            });
        });

        const addConditionEl = container.createEl("div", {cls: "add-condition-icon"});
        setIcon(addConditionEl, "plus-circle");
        addConditionEl.title = "Add Condition";
        addConditionEl.addEventListener("click", () => {
            this.openAddConditions(character, () => {
                container.empty();
                this.buildConditionIcons(container, character, onChange);
                onChange?.();
                this.save();
            });
        });
    }

    /** Opens the Add Conditions modal for a hero or creature; `onAdded` runs after conditions were added. */
    private openAddConditions(character: Hero | CreatureInstance, onAdded: () => void): void {
        new AddConditionsModal(this.app, character, this.conditionManager, (newConditions) => {
            character.conditions = (character.conditions || []).concat(newConditions);
            onAdded();
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

    /** Small, display-only condition icons for a creature instance cell in the grid. */
    private buildInstanceConditionIcons(container: HTMLElement, instance: CreatureInstance): void {
        (instance.conditions || []).forEach((conditionEntry) => this.renderConditionIcon(container, conditionEntry));
    }

    /** Renders one condition icon (with its color/effect customizations); null if the condition is unknown. */
    private renderConditionIcon(container: HTMLElement, conditionEntry: string | Condition): HTMLElement | null {
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
        const iconEl = container.createEl("div", {cls: "condition-icon"});
        setIcon(iconEl, condition.iconName);
        iconEl.title = condition.displayName;

        // Apply color and effect customizations
        if (conditionData) {
            if (conditionData.color) {
                iconEl.style.color = conditionData.color;
            }
            if (conditionData.effect) {
                iconEl.classList.add(`condition-effect-${conditionData.effect}`);
            }
        }
        return iconEl;
    }

    private isHero(character: Hero | CreatureInstance): character is Hero {
        return "isHero" in character ? character.isHero : false;
    }
}
