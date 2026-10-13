import {App, MarkdownPostProcessorContext, MarkdownRenderChild} from "obsidian";
import {ConditionManager} from "@utils/Conditions";
import {getWrittenEncounter, parseEncounterData} from "./EncounterData";
import {applyParty, PartyStore} from "@drawSteelAdmonition/party/PartyData";
import {InitiativeTracker, TrackerServices} from "@drawSteelAdmonition/initiative/InitiativeTracker";
import {StatblockCache} from "@drawSteelAdmonition/initiative/CreatureView";
import {HeroSheetStore} from "@drawSteelAdmonition/hero/HeroSheet";
import {TrackerHotkeys} from "@drawSteelAdmonition/initiative/TrackerHotkeys";
import DrawSteelAdmonitionPlugin from "main";

export class InitiativeProcessor {
    private app: App;
    private plugin: DrawSteelAdmonitionPlugin;
    readonly handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => this.postProcess(source, el, ctx);
    private services: TrackerServices;
    private hotkeys: TrackerHotkeys;

    constructor(plugin: DrawSteelAdmonitionPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.services = {
            plugin,
            conditionManager: new ConditionManager(
                () => (this.plugin.settings.conditionStyles ??= {}),
                () => this.plugin.saveSettings()
            ),
            statblocks: new StatblockCache(plugin),
        };
        this.hotkeys = new TrackerHotkeys(plugin);
    }

    public async postProcess(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        const container = el.createEl("div", {cls: "ds-init-container"});

        try {
            // Re-render after our own write: build synchronously from the state we wrote (no flicker)
            let data = getWrittenEncounter(ctx.sourcePath, source);
            if (!data) {
                data = await parseEncounterData(source, this.app, this.plugin.settings);
                await applyParty(data, this.app, this.plugin.settings, ctx.sourcePath);
            }
            const tracker = new InitiativeTracker(this.services, container, data, ctx);
            tracker.render();
            const child = new MarkdownRenderChild(container);
            child.register(this.hotkeys.register(tracker));
            this.watchLinkedNotes(child, tracker, ctx);
            ctx.addChild(child);
            // Avoid clicks in reading mode from opening edit view
            const stop = (e: Event) => {
                // Let the resize handles receive their drag
                if ((e.target as HTMLElement).closest?.(".ds-init-resizer")) return;
                e.preventDefault();
                e.stopPropagation();
            };
            // container.addEventListener("dblclick", stop, { capture: true });
            container.addEventListener("mousedown", stop, {capture: true});
            container.addEventListener("pointerdown", stop, {capture: true});
        } catch (error) {
            // Display error message to the user
            let userMessage =
                "The Draw Steel Elements plugin loaded the Initiative Tracker properly, but " +
                "failed to process the input config.  Please correct the following error:\n\n";
            userMessage += error.message;
            container.createEl("div", {text: userMessage, cls: "error-message ds-container"});
        }
    }

    /**
     * Re-renders the tracker when a note it reads hero state from changes: the party note, or a hero's
     * ds-hero note (e.g. edited from the hero sheet, another encounter or the party view).
     */
    private watchLinkedNotes(child: MarkdownRenderChild, tracker: InitiativeTracker, ctx: MarkdownPostProcessorContext): void {
        const data = tracker.encounter;
        const partyPath = data.party ? PartyStore.resolveFile(this.app, data.party, ctx.sourcePath).path : null;
        child.registerEvent(this.app.vault.on("modify", async (file) => {
            try {
                if (file.path === partyPath) {
                    await applyParty(data, this.app, this.plugin.settings, ctx.sourcePath);
                } else {
                    const linked = data.heroes.filter((hero) => hero.sheet_path === file.path);
                    if (linked.length === 0) return;
                    for (const hero of linked) {
                        await HeroSheetStore.reloadHero(this.app, hero);
                    }
                }
                tracker.render();
            } catch (e) {
                console.warn("Draw Steel Elements: failed to refresh heroes.", e);
            }
        }));
    }
}
