import {MarkdownPostProcessorContext, MarkdownRenderChild, Notice, parseYaml} from "obsidian";
import {HeroSheet, HeroSheetStore, loadHeroSheet} from "@drawSteelAdmonition/hero/HeroSheet";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {HeroSheetView} from "@drawSteelAdmonition/hero/HeroSheetView";
import DrawSteelAdmonitionPlugin from "main";

/**
 * Renders a `ds-hero` block: an interactive hero sheet. Changes are written back to the block; parties and
 * encounters linking to the note with `statblock: [[Note]]` share its stamina and recoveries.
 */
export class HeroProcessor {
    readonly handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => this.postProcess(source, el, ctx);

    constructor(private plugin: DrawSteelAdmonitionPlugin) {
    }

    public async postProcess(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        const container = el.createEl("div", {cls: "ds-hero-container ds-sb-container ds-container"});
        try {
            const resolver = new ReferenceResolver(this.plugin.app, this.plugin.settings);
            const sheet = await loadHeroSheet(this.plugin.app, resolver, parseYaml(source));
            this.buildSheet(container, sheet, ctx);
            this.watchNote(container, sheet, ctx);
            // Avoid clicks in reading mode from opening edit view
            const stop = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };
            container.addEventListener("mousedown", stop, {capture: true});
            container.addEventListener("pointerdown", stop, {capture: true});
        } catch (error) {
            let userMessage =
                "The Draw Steel Elements plugin loaded the Hero properly, but " +
                "failed to process the input config.  Please correct the following error:\n\n";
            userMessage += error.message;
            container.createEl("div", {text: userMessage, cls: "error-message ds-container"});
        }
    }

    private buildSheet(container: HTMLElement, sheet: HeroSheet, ctx: MarkdownPostProcessorContext): void {
        new HeroSheetView(this.plugin, sheet, ctx, {
            showStamina: true,
            onChange: (state) => {
                if (!ctx.sourcePath) {
                    new Notice("Draw Steel Elements: a hero must be in a regular note to be saved (not a canvas).");
                    return;
                }
                HeroSheetStore.saveState(this.plugin.app, ctx.sourcePath, state);
            },
        }).build(container);
    }

    /**
     * Re-renders the sheet when its note changes, e.g. stamina spent from an initiative tracker or a party,
     * or when its kit notes change. Obsidian doesn't always re-render an open block on its own.
     */
    private watchNote(container: HTMLElement, sheet: HeroSheet, ctx: MarkdownPostProcessorContext): void {
        if (!ctx.sourcePath) return;
        let current = sheet;
        const child = new MarkdownRenderChild(container);
        child.registerEvent(this.plugin.app.vault.on("modify", async (file) => {
            const kitPaths = (current.kits_details ?? []).map((kit) => kit.path);
            if (file.path !== ctx.sourcePath && !kitPaths.includes(file.path)) return;
            try {
                // Only the note's first ds-hero block is saved to, so only that one is refreshed
                const raw = await HeroSheetStore.load(this.plugin.app, ctx.sourcePath);
                if (raw?.name !== current.name) return;
                const resolver = new ReferenceResolver(this.plugin.app, this.plugin.settings);
                current = await loadHeroSheet(this.plugin.app, resolver, raw);
                container.empty();
                this.buildSheet(container, current, ctx);
            } catch (e) {
                console.warn("Draw Steel Elements: failed to refresh the hero sheet.", e);
            }
        }));
        ctx.addChild(child);
    }
}
