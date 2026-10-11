import {App, MarkdownPostProcessorContext, Modal, Notice, TFile} from "obsidian";
import {Hero} from "@drawSteelAdmonition/EncounterData";
import {parsePartyData, PartyData, PartyStore} from "@drawSteelAdmonition/party/PartyData";
import {buildRecoveryControl} from "@drawSteelAdmonition/party/RecoveryControl";
import {StaminaEditModal} from "@views/StaminaEditModal";
import {StaminaBar} from "@model/StaminaBar";
import {Images} from "@utils/Images";
import {Stamina} from "@utils/Stamina";
import DrawSteelAdmonitionPlugin from "main";

/**
 * Renders a `ds-party` block: the heroes shared by every initiative tracker that links to this note
 * with `party: [[Note]]`. Their stamina and recoveries are saved here.
 */
export class PartyProcessor {
    private app: App;
    private plugin: DrawSteelAdmonitionPlugin;
    readonly handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => this.postProcess(source, el, ctx);

    constructor(plugin: DrawSteelAdmonitionPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    public async postProcess(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        const container = el.createEl("div", {cls: "ds-init-container ds-party-container"});

        try {
            const data = await parsePartyData(source, this.app, this.plugin.settings);
            this.buildUI(container, data, ctx);
            // Avoid clicks in reading mode from opening edit view
            const stop = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };
            container.addEventListener("mousedown", stop, {capture: true});
            container.addEventListener("pointerdown", stop, {capture: true});
        } catch (error) {
            let userMessage =
                "The Draw Steel Elements plugin loaded the Party properly, but " +
                "failed to process the input config.  Please correct the following error:\n\n";
            userMessage += error.message;
            container.createEl("div", {text: userMessage, cls: "error-message ds-container"});
        }
    }

    private save(heroes: Hero[], ctx: MarkdownPostProcessorContext): void {
        const file = ctx.sourcePath ? this.app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
        if (!(file instanceof TFile)) {
            new Notice("Draw Steel Elements: a party must be in a regular note to be saved (not a canvas).");
            return;
        }
        PartyStore.saveHeroes(this.app, file, heroes);
    }

    private buildUI(container: HTMLElement, data: PartyData, ctx: MarkdownPostProcessorContext): void {
        const topActionBar = container.createEl("div", {cls: "top-action-bar"});
        const respiteButton = topActionBar.createEl("button", {text: "Respite", cls: "respite-button"});
        respiteButton.title = "Restore all heroes to full Stamina and Recoveries";
        respiteButton.addEventListener("click", () => {
            new RespiteModal(this.app, () => {
                data.heroes.forEach((hero) => {
                    hero.current_stamina = hero.max_stamina;
                    hero.temp_stamina = 0;
                    if (hero.max_recoveries != null) {
                        hero.current_recoveries = hero.max_recoveries;
                    }
                });
                container.empty();
                this.buildUI(container, data, ctx);
                this.save(data.heroes, ctx);
            }).open();
        });

        const heroesContainer = container.createEl("div", {cls: "heroes-container"});
        heroesContainer.createEl("h3", {text: data.name ?? "Party"});
        data.heroes.forEach((hero) => {
            const heroContEl = heroesContainer.createEl("div", {cls: "hero-container"});
            this.buildHeroRow(heroContEl, hero, ctx);
        });
    }

    private buildHeroRow(container: HTMLElement, hero: Hero, ctx: MarkdownPostProcessorContext): void {
        const rowEl = container.createEl("div", {cls: "character-row"});

        const imageEl = rowEl.createEl("div", {cls: "character-image"});
        Images.resolveImageSourceOrDefault(this.app, hero.image ?? null, this.plugin.settings.defaultImagePath)
            .then((imgSrc) => {
                imageEl.createEl("img", {attr: {src: imgSrc, alt: hero.name}});
            });

        const infoEl = rowEl.createEl("div", {cls: "character-info"});
        infoEl.createEl("div", {cls: "character-name", text: hero.name});
        if (hero.max_recoveries != null) {
            infoEl.createEl("div", {
                cls: "hero-recovery-value",
                text: `Recovery value: ${Stamina.recoveryValue(hero.max_stamina, hero.recovery_value)}`,
            });
        }

        const healthEl = rowEl.createEl("div", {cls: "character-right"}).createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});
        this.updateStaminaDisplay(staminaEl, hero);

        staminaEl.addEventListener("click", () => {
            const staminaBar = StaminaBar.fromHero(hero);
            const recovery = hero.max_recoveries == null ? undefined : {
                current: hero.current_recoveries ?? hero.max_recoveries,
                max: hero.max_recoveries,
                value: Stamina.recoveryValue(hero.max_stamina, hero.recovery_value),
            };
            new StaminaEditModal(this.app, staminaBar, true, hero.name, (result) => {
                staminaBar.updateHero(hero);
                if (hero.max_recoveries != null) {
                    hero.current_recoveries = (hero.current_recoveries ?? hero.max_recoveries) - result.recoveriesSpent;
                }
                container.empty();
                this.buildHeroRow(container, hero, ctx);
                this.save([hero], ctx);
            }, true, recovery).open();
        });

        buildRecoveryControl(healthEl, hero, () => this.save([hero], ctx));
    }

    private updateStaminaDisplay(staminaEl: HTMLElement, hero: Hero): void {
        const current = hero.current_stamina ?? hero.max_stamina;
        const temp = hero.temp_stamina ?? 0;
        staminaEl.setText(`${current}${temp > 0 ? `(+${temp})` : ""}/${hero.max_stamina}`);
        staminaEl.style.color = current < 0 ? "red" : temp > 0 ? "green" : "";

        const winded = Stamina.isWinded(current, hero.max_stamina);
        staminaEl.toggleClass("is-winded", winded);
        if (winded) {
            staminaEl.createEl("span", {cls: "stamina-winded-tag", text: "Winded"});
        }
        const status = Stamina.status(current, hero.max_stamina, true);
        if (status === "dying" || status === "dead") {
            staminaEl.createEl("span", {cls: "stamina-dying-tag", text: status === "dying" ? "Dying" : "Dead"});
        }
    }
}

class RespiteModal extends Modal {
    private onConfirm: () => void;

    constructor(app: App, onConfirm: () => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        contentEl.createEl("h2", {text: "Take a Respite?"});
        contentEl.createEl("p", {
            text: "All heroes in this party regain all their Stamina and Recoveries, and lose any temporary Stamina.",
        });

        const buttonContainer = contentEl.createEl("div", {cls: "modal-button-container"});
        const confirmButton = buttonContainer.createEl("button", {text: "Respite", cls: "mod-cta"});
        const cancelButton = buttonContainer.createEl("button", {text: "Cancel"});
        confirmButton.addEventListener("click", () => {
            this.onConfirm();
            this.close();
        });
        cancelButton.addEventListener("click", () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}
