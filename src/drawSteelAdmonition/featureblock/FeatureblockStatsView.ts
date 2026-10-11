import {Plugin, MarkdownPostProcessorContext} from "obsidian";
import {FeatureblockConfig} from "@model/FeatureblockConfig";
import {BoldKeyWithValueView} from "@drawSteelAdmonition/Common/BoldKeyWithValueView";

export class FeatureblockStatsView {
    private plugin: Plugin;
    private data: FeatureblockConfig;
    private ctx: MarkdownPostProcessorContext;

    constructor(plugin: Plugin, data: FeatureblockConfig, ctx: MarkdownPostProcessorContext) {
        this.plugin = plugin;
        this.data = data;
        this.ctx = ctx;
    }

    public build(parent: HTMLElement) {
        const statsContainer = parent.createEl("div", {cls: "ds-fb-stats"});

        if (this.data.featureblock.stamina || this.data.featureblock.size) {
            const line = statsContainer.createEl("div", {cls: "ds-fb-stats-row"});
            if (this.data.featureblock.stamina) {
                new BoldKeyWithValueView(this.plugin, "Stamina", this.data.featureblock.stamina, this.ctx)
                    .buildWithClasses(line, "ds-fb-stats-left");
            }
            if (this.data.featureblock.size) {
                new BoldKeyWithValueView(this.plugin, "Size", this.data.featureblock.size, this.ctx)
                    .buildWithClasses(line, "ds-fb-stats-right");
            }
        }

        if (!this.data.featureblock.stats || this.data.featureblock.stats.length === 0) {
            return;
        }

        // Two stats per line
        const stats = this.data.featureblock.stats;
        for (let i = 0; i < stats.length; i += 2) {
            const line = statsContainer.createEl("div", {cls: "ds-fb-stats-row"});
            new BoldKeyWithValueView(this.plugin, stats[i].name, stats[i].value, this.ctx)
                .buildWithClasses(line, "ds-fb-stats-left");
            if (i + 1 < stats.length) {
                new BoldKeyWithValueView(this.plugin, stats[i + 1].name, stats[i + 1].value, this.ctx)
                    .buildWithClasses(line, "ds-fb-stats-right");
            }
        }
    }
}
