import {App, MarkdownPostProcessorContext, MarkdownRenderer, setIcon} from "obsidian";
import {HeaderView} from "@drawSteelAdmonition/Common/HeaderView";
import {StatsView} from "@drawSteelAdmonition/statblock/StatsView";
import {FeaturesView} from "@drawSteelAdmonition/Features/FeaturesView";
import {HorizontalRuleProcessor} from "@drawSteelAdmonition/Common/horizontalRuleProcessor";
import {FeatureConfig} from "@model/FeatureConfig";
import {StaminaBar} from "@model/StaminaBar";
import {StaminaEditModal} from "@views/StaminaEditModal";
import {buildRecoveryControl} from "@drawSteelAdmonition/party/RecoveryControl";
import {Stamina} from "@utils/Stamina";
import {
    echelon,
    HeroKit,
    HeroSheet,
    HeroSheetState,
    sheetAsHero,
    sheetAsStatblock,
    standardFreeStrikes,
} from "@drawSteelAdmonition/hero/HeroSheet";
import {Feature} from "steel-compendium-sdk";
import DrawSteelAdmonitionPlugin from "main";

export interface HeroSheetViewOptions {
    /**
     * Show the stamina and recoveries controls. Off in the initiative tracker's creature view, which shows
     * them in its own summary.
     */
    showStamina: boolean;
    /** Called with the state fields that changed; the view has already updated `sheet`. */
    onChange: (state: HeroSheetState) => void;
}

// Heroes whose free strikes are shown, by name; kept across the re-render that follows every save
const freeStrikesOpen = new Set<string>();

/** Renders a hero sheet: header, play state (stamina, recoveries, resource, surges, victories), stats and abilities. */
export class HeroSheetView {
    private app: App;
    private freeStrikesEl: HTMLElement;
    private freeStrikesButton: HTMLElement;

    constructor(
        private plugin: DrawSteelAdmonitionPlugin,
        private sheet: HeroSheet,
        private ctx: MarkdownPostProcessorContext,
        private options: HeroSheetViewOptions,
    ) {
        this.app = plugin.app;
    }

    public build(container: HTMLElement): void {
        const sheet = this.sheet;
        const statblock = sheetAsStatblock(sheet);

        const subtitle = [sheet.level != null ? `Level ${sheet.level}` : null, sheet.class].filter(Boolean).join(" ");
        const ancestry = Array.isArray(sheet.ancestry) ? sheet.ancestry.join(", ") : sheet.ancestry ?? "";
        new HeaderView(this.plugin, this.ctx, sheet.name, subtitle, ancestry, sheet.subclass ?? "").build(container);

        this.buildVitals(container.createEl("div", {cls: "ds-hero-vitals"}));
        this.freeStrikesEl = container.createEl("div", {cls: "ds-hero-free-strikes"});
        this.renderFreeStrikes();
        const kits = sheet.kits_details ?? [];
        kits.forEach((kit) => this.buildKitLine(container.createEl("div", {cls: "ds-hero-kit"}), kit, kits.length > 1));

        new StatsView(this.plugin, statblock, this.ctx, false).build(container);
        if (statblock.statblock.features?.length > 0) {
            HorizontalRuleProcessor.build(container);
            const featureConfigs = statblock.statblock.features.map((f) => new FeatureConfig(f));
            new FeaturesView(this.plugin, featureConfigs, this.ctx).build(container);
        }
        kits.filter((kit) => kit.signature_ability).forEach((kit) => this.buildKitSignature(container, kit));
    }

    /** "Kit: Mountain · Stamina +9 · Stability +2 · …"; the kit name opens its note. */
    private buildKitLine(container: HTMLElement, kit: HeroKit, twoKits: boolean): void {
        container.createEl("span", {cls: "ds-hero-kit-label", text: "Kit: "});
        const nameEl = container.createEl(kit.path ? "a" : "span", {cls: "ds-hero-kit-name", text: kit.name ?? "Kit"});
        if (kit.path) {
            nameEl.addClass("internal-link");
            nameEl.addEventListener("click", (e: MouseEvent) => {
                e.preventDefault();
                this.app.workspace.openLinkText(kit.path!, this.ctx.sourcePath, e.ctrlKey || e.metaKey);
            });
        }
        if (kit.error) {
            container.createEl("span", {cls: "ds-hero-kit-error", text: ` (${kit.error})`});
            return;
        }
        const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);
        const bonuses: string[] = [];
        if (kit.stamina_bonus) {
            bonuses.push(`Stamina ${signed(kit.stamina_bonus * echelon(this.sheet.level))}`);
        }
        if (kit.speed_bonus) bonuses.push(`Speed ${signed(kit.speed_bonus)}`);
        if (kit.stability_bonus) bonuses.push(`Stability ${signed(kit.stability_bonus)}`);
        if (kit.disengage_bonus) bonuses.push(`Disengage ${signed(kit.disengage_bonus)}`);
        if (kit.melee_damage_bonus) bonuses.push(`Melee damage ${kit.melee_damage_bonus}`);
        if (kit.ranged_damage_bonus) bonuses.push(`Ranged damage ${kit.ranged_damage_bonus}`);
        if (kit.melee_distance_bonus) bonuses.push(`Melee distance ${signed(kit.melee_distance_bonus)}`);
        if (kit.ranged_distance_bonus) bonuses.push(`Ranged distance ${signed(kit.ranged_distance_bonus)}`);
        if (bonuses.length > 0) {
            container.createEl("span", {cls: "ds-hero-kit-bonuses", text: ` · ${bonuses.join(" · ")}`});
        }
        container.title = twoKits
            ? "Bonuses from two kits don't stack: the higher of each is included in the stats and free strikes"
            : "Kit bonuses are included in the stats and free strikes";
    }

    /** The kit's signature ability, rendered from the kit note's markdown. */
    private buildKitSignature(container: HTMLElement, kit: HeroKit): void {
        HorizontalRuleProcessor.build(container);
        const sectionEl = container.createEl("div", {cls: "ds-hero-kit-signature"});
        sectionEl.createEl("div", {cls: "ds-hero-kit-signature-title", text: `Kit Signature Ability (${kit.name ?? "Kit"})`});
        MarkdownRenderer.render(this.app, kit.signature_ability!, sectionEl.createEl("div"), kit.path ?? this.ctx.sourcePath, this.plugin);
    }

    private buildVitals(container: HTMLElement): void {
        const sheet = this.sheet;

        if (this.options.showStamina) {
            const healthEl = container.createEl("div", {cls: "ds-hero-vital ds-hero-health"});
            const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});
            this.updateStaminaDisplay(staminaEl);
            staminaEl.title = "Edit Stamina";
            staminaEl.addEventListener("click", () => this.openStaminaModal());

            const hero = sheetAsHero(sheet);
            buildRecoveryControl(healthEl, hero, () => this.options.onChange({current_recoveries: sheet.current_recoveries}));
            if (sheet.max_recoveries != null) {
                healthEl.createEl("div", {
                    cls: "hero-recovery-value",
                    text: `Recovery value: ${Stamina.recoveryValue(sheet.max_stamina, sheet.recovery_value)}`,
                });
            }
        }

        const counters = container.createEl("div", {cls: "ds-hero-counters"});
        this.buildCounter(counters, sheet.heroic_resource ?? "Resource", () => sheet.resource ?? 0, (value) => {
            sheet.resource = value;
            this.options.onChange({resource: value});
        }, true);
        this.buildCounter(counters, "Surges", () => sheet.surges ?? 0, (value) => {
            sheet.surges = value;
            this.options.onChange({surges: value});
        });
        this.buildCounter(counters, "Victories", () => sheet.victories ?? 0, (value) => {
            sheet.victories = value;
            this.options.onChange({victories: value});
        });

        this.freeStrikesButton = counters.createEl("button", {cls: "ds-hero-free-strikes-button", text: "Free Strikes"});
        this.freeStrikesButton.title = "Show the free strikes this hero can make";
        this.freeStrikesButton.addEventListener("click", () => {
            if (freeStrikesOpen.has(sheet.name)) {
                freeStrikesOpen.delete(sheet.name);
            } else {
                freeStrikesOpen.add(sheet.name);
            }
            this.renderFreeStrikes();
        });

        if (this.options.showStamina) {
            const respiteEl = counters.createEl("button", {cls: "ds-hero-respite", text: "Respite"});
            respiteEl.title = "Regain all Stamina and Recoveries, lose temporary Stamina";
            respiteEl.addEventListener("click", () => {
                sheet.current_stamina = sheet.max_stamina;
                sheet.temp_stamina = 0;
                const state: HeroSheetState = {current_stamina: sheet.max_stamina, temp_stamina: 0};
                if (sheet.max_recoveries != null) {
                    sheet.current_recoveries = sheet.max_recoveries;
                    state.current_recoveries = sheet.max_recoveries;
                }
                this.options.onChange(state);
            });
        }
    }

    /** The standard melee and ranged free strikes, plus any of the hero's abilities that are free strikes. */
    private renderFreeStrikes(): void {
        const open = freeStrikesOpen.has(this.sheet.name);
        this.freeStrikesButton.toggleClass("is-active", open);
        this.freeStrikesEl.empty();
        this.freeStrikesEl.toggle(open);
        if (!open) return;

        const classStrikes = (this.sheet.features ?? [])
            .filter((feature) => /free strike/i.test(feature?.ability_type ?? ""));
        const configs = standardFreeStrikes(this.sheet).concat(classStrikes)
            .map((dto) => new FeatureConfig(Feature.modelDTOAdapter(dto)));
        new FeaturesView(this.plugin, configs, this.ctx).build(this.freeStrikesEl);
    }

    /** A "Label  - value +" counter. Heroic resources can go negative (some classes allow it); the others can't. */
    private buildCounter(container: HTMLElement, label: string, get: () => number, set: (value: number) => void, allowNegative = false): void {
        const counterEl = container.createEl("div", {cls: "ds-hero-counter"});
        counterEl.createEl("span", {cls: "ds-hero-counter-label", text: label});
        const minusEl = counterEl.createEl("div", {cls: "recovery-adjust-btn"});
        setIcon(minusEl, "minus");
        const valueEl = counterEl.createEl("span", {cls: "ds-hero-counter-value", text: `${get()}`});
        const plusEl = counterEl.createEl("div", {cls: "recovery-adjust-btn"});
        setIcon(plusEl, "plus");

        const change = (delta: number) => {
            const value = get() + delta;
            if (value < 0 && !allowNegative) return;
            valueEl.setText(`${value}`);
            set(value);
        };
        minusEl.addEventListener("click", () => change(-1));
        plusEl.addEventListener("click", () => change(1));
    }

    private openStaminaModal(): void {
        const sheet = this.sheet;
        const hero = sheetAsHero(sheet);
        const staminaBar = StaminaBar.fromHero(hero);
        const recovery = sheet.max_recoveries == null ? undefined : {
            current: sheet.current_recoveries ?? sheet.max_recoveries,
            max: sheet.max_recoveries,
            value: Stamina.recoveryValue(sheet.max_stamina, sheet.recovery_value),
        };
        new StaminaEditModal(this.app, staminaBar, true, sheet.name, (result) => {
            staminaBar.updateHero(hero);
            const state: HeroSheetState = {current_stamina: sheet.current_stamina, temp_stamina: sheet.temp_stamina};
            if (sheet.max_recoveries != null) {
                sheet.current_recoveries = (sheet.current_recoveries ?? sheet.max_recoveries) - result.recoveriesSpent;
                state.current_recoveries = sheet.current_recoveries;
            }
            this.options.onChange(state);
        }, true, recovery).open();
    }

    private updateStaminaDisplay(staminaEl: HTMLElement): void {
        const sheet = this.sheet;
        const current = sheet.current_stamina ?? sheet.max_stamina;
        const temp = sheet.temp_stamina ?? 0;
        staminaEl.setText(`Stamina ${current}${temp > 0 ? `(+${temp})` : ""}/${sheet.max_stamina}`);
        staminaEl.style.color = current < 0 ? "red" : temp > 0 ? "green" : "";

        if (Stamina.isWinded(current, sheet.max_stamina)) {
            staminaEl.addClass("is-winded");
            staminaEl.createEl("span", {cls: "stamina-winded-tag", text: "Winded"});
        }
        const status = Stamina.status(current, sheet.max_stamina, true);
        if (status === "dying" || status === "dead") {
            staminaEl.createEl("span", {cls: "stamina-dying-tag", text: status === "dying" ? "Dying" : "Dead"});
        }
    }
}
