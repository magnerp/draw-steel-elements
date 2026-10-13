import {App, parseYaml, TFile} from "obsidian";
import {DSESettings} from "@model/Settings";

export class ReferenceResolver {
    readonly app: App;
    private settings: DSESettings;

    constructor(app: App, settings: DSESettings) {
        this.app = app;
        this.settings = settings;
    }

    public async resolveReferences(data: any): Promise<any> {
        if (typeof data === 'string') {
            return await this.resolvePath(ReferenceResolver.referencePath(data));
        }

        if (Array.isArray(data)) {
            return await Promise.all(data.map(item => this.resolveReferences(item)));
        }

        if (typeof data === 'object' && data !== null) {
            const resolvedData: any = {};
            for (const key of Object.keys(data)) {
                resolvedData[key] = await this.resolveReferences(data[key]);
            }
            return resolvedData;
        }

        return data;
    }

    /** The vault path a string reference points at: `@path`, `[[Note]]` (alias/heading dropped), or a plain path. */
    public static referencePath(ref: string): string {
        if (ref.startsWith('@')) {
            return ref.substring(1);
        } else if (ref.startsWith('[[') && ref.endsWith(']]')) {
            // Drop an alias ([[Note|Alias]]) or heading ([[Note#Heading]])
            return ref.substring(2, ref.length - 2).split('|')[0].split('#')[0].trim();
        }
        return ref;
    }

    /** The note a string reference points at, or null if it can't be found. */
    public resolveFile(ref: string): TFile | null {
        return this.findFile(ReferenceResolver.referencePath(ref));
    }

    public async resolvePath(path: string): Promise<any> {
        let file = this.findFile(path);

        if (!file || !(file instanceof TFile)) {
            console.warn(`Draw Steel Elements: Reference file not found: ${path}`);
            throw new Error(`Reference file (${path}) not found in root, ${this.settings.compendiumDestinationDirectory}, or when searching the cache`);
        }

        const content = await this.app.vault.read(file);

        // Regex to find the first ds- block
        // Matches ```ds-<something> ... ``` or ~~~ds-<something> ... ~~~
        const blockRegex = /^([`~]{3,})ds-[\w-]+\s*\n([\s\S]+?)\n^\1/m;
        const match = content.match(blockRegex);

        if (!match) {
            // Some compendium notes (e.g. retainers) are plain markdown with the stats in frontmatter
            const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter?.stamina != null) {
                return {
                    name: frontmatter.item_name ?? frontmatter.name ?? file.basename,
                    stamina: frontmatter.stamina,
                    image: frontmatter.image,
                    roles: frontmatter.roles,
                };
            }
            throw new Error(`No Draw Steel Elements code block (ds-*) or frontmatter 'stamina' found in ${file.path}`);
        }

        const yamlContent = match[2];
        try {
            return parseYaml(yamlContent);
        } catch (e) {
            throw new Error(`Failed to parse YAML in ${file.path}: ${e.message}`);
        }
    }

    private findFile(path: string): TFile | null {
        // 1. Try exact path from root
        let file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return file;

        // 2. Try path from root with .md extension
        if (!path.endsWith('.md')) {
            file = this.app.vault.getAbstractFileByPath(path + '.md');
            if (file instanceof TFile) return file;
        }

        // 3. Try path relative to compendium directory
        const compendiumPath = `${this.settings.compendiumDestinationDirectory}/${path}`;
        file = this.app.vault.getAbstractFileByPath(compendiumPath);
        if (file instanceof TFile) return file;

        // 4. Try path relative to compendium directory with .md extension
        if (!path.endsWith('.md')) {
            file = this.app.vault.getAbstractFileByPath(compendiumPath + '.md');
            if (file instanceof TFile) return file;
        }

        // 5. Try resolving by name using Obsidian's metadata cache
        // This handles cases like "Thorn Dragon" finding "Folders/Thorn Dragon.md"
        file = this.app.metadataCache.getFirstLinkpathDest(path, "");
        if (file instanceof TFile) return file;

        return null;
    }
}
