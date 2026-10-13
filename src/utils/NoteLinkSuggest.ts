import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    prepareFuzzySearch,
    renderMatches,
    SearchResult,
    TFile,
} from "obsidian";

export interface NoteSuggestion {
    file: TFile;
    match: SearchResult | null; // Match in the note name (for highlighting); null for path-only matches
    score: number;
}

// `statblock:` / `party:` / `kit:` value being typed as a link, e.g. `  - statblock: [[Thorn Dr`
const LINK_FIELD_REGEX = /^\s*(?:-\s*)?(?:statblock|party|kits?)\s*:\s*["']?\[\[([^\[\]]*)$/;
// A further kit in an inline list, e.g. `kit: ["[[Shining Armor]]", "[[Sni`
const KIT_LIST_REGEX = /^\s*kits?\s*:\s*\[(?:.*["',\[])?\s*\[\[([^\[\]]*)$/;
// An item of a block list, e.g. `  - "[[Sni`; a kit if the list belongs to `kit:` / `kits:`
const LIST_ITEM_REGEX = /^\s*-\s*["']?\[\[([^\[\]]*)$/;
const KIT_FIELD_LINE_REGEX = /^\s*kits?\s*:\s*$/;
const FENCE_REGEX = /^\s*(`{3,}|~{3,})(.*)$/;
const MAX_FENCE_SEARCH_LINES = 1000;
const MAX_SUGGESTIONS = 50;

/** Fuzzy-searches notes by name (ranked first) and path. An empty query lists notes alphabetically. */
export function searchNotes(files: TFile[], query: string): NoteSuggestion[] {
    query = query.trim();
    if (!query) {
        return files
            .slice()
            .sort((a, b) => a.basename.localeCompare(b.basename))
            .slice(0, MAX_SUGGESTIONS)
            .map((file) => ({file, match: null, score: 0}));
    }

    const fuzzy = prepareFuzzySearch(query);
    const results: NoteSuggestion[] = [];
    files.forEach((file) => {
        const match = fuzzy(file.basename);
        if (match) {
            // Name matches always rank above path-only matches
            results.push({file, match, score: 1000 + match.score});
            return;
        }
        const pathMatch = fuzzy(file.path);
        if (pathMatch) {
            results.push({file, match: null, score: pathMatch.score});
        }
    });
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SUGGESTIONS);
}

/**
 * Notes that look like statblocks: `stamina` in their frontmatter (every compendium statblock has
 * it), `type: hero` (hero sheets) or "statblock" in their path.
 */
export function statblockFiles(app: App): TFile[] {
    return app.vault.getMarkdownFiles().filter((file) => {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        return frontmatter?.stamina != null || frontmatter?.type === "hero" || /statblock/i.test(file.path);
    });
}

/** Searches statblock notes, falling back to all notes when no statblock note matches. */
export function searchStatblocks(app: App, query: string): NoteSuggestion[] {
    const results = searchNotes(statblockFiles(app), query);
    return results.length > 0 ? results : searchNotes(app.vault.getMarkdownFiles(), query);
}

/** Kit notes: `type: kit` in their frontmatter (every compendium kit has it). */
function kitFiles(app: App): TFile[] {
    return app.vault.getMarkdownFiles().filter((file) => app.metadataCache.getFileCache(file)?.frontmatter?.type === "kit");
}

/** Searches kit notes, falling back to all notes when no kit note matches. */
function searchKits(app: App, query: string): NoteSuggestion[] {
    const results = searchNotes(kitFiles(app), query);
    return results.length > 0 ? results : searchNotes(app.vault.getMarkdownFiles(), query);
}

export function renderNoteSuggestion(suggestion: NoteSuggestion, el: HTMLElement): void {
    const content = el.createEl("div", {cls: "suggestion-content"});
    const title = content.createEl("div", {cls: "suggestion-title"});
    renderMatches(title, suggestion.file.basename, suggestion.match?.matches ?? null);
    content.createEl("div", {cls: "suggestion-note", text: suggestion.file.path});
}

/**
 * Obsidian's own [[link]] suggestions don't work inside code blocks. This offers note suggestions
 * when typing `[[` as the value of `statblock:`, `party:` or `kit:` inside a Draw Steel Elements (ds-*) block.
 */
export class NoteLinkSuggest extends EditorSuggest<NoteSuggestion> {
    constructor(app: App) {
        super(app);
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        const beforeCursor = editor.getLine(cursor.line).substring(0, cursor.ch);
        const match = beforeCursor.match(LINK_FIELD_REGEX) ?? beforeCursor.match(KIT_LIST_REGEX)
            ?? (this.isKitListItem(editor, cursor.line) ? beforeCursor.match(LIST_ITEM_REGEX) : null);
        if (!match || !this.isInDseCodeBlock(editor, cursor.line)) {
            return null;
        }
        return {
            start: {line: cursor.line, ch: cursor.ch - match[1].length - 2},
            end: cursor,
            query: match[1],
        };
    }

    getSuggestions(context: EditorSuggestContext): NoteSuggestion[] {
        // `statblock:` suggests statblock notes first, `kit:` kit notes; `party:` any note
        const line = context.editor.getLine(context.start.line);
        if (/statblock\s*:/.test(line)) return searchStatblocks(this.app, context.query);
        if (/kits?\s*:/.test(line) || this.isKitListItem(context.editor, context.start.line)) {
            return searchKits(this.app, context.query);
        }
        return searchNotes(this.app.vault.getMarkdownFiles(), context.query);
    }

    renderSuggestion(suggestion: NoteSuggestion, el: HTMLElement): void {
        renderNoteSuggestion(suggestion, el);
    }

    selectSuggestion(suggestion: NoteSuggestion, evt: MouseEvent | KeyboardEvent): void {
        const context = this.context;
        if (!context) return;

        const editor = context.editor;
        const linkText = this.app.metadataCache.fileToLinktext(suggestion.file, "", true);
        // Also replace closing brackets that were auto-inserted after the cursor
        const afterCursor = editor.getLine(context.end.line).substring(context.end.ch);
        const end = afterCursor.startsWith("]]") ? {line: context.end.line, ch: context.end.ch + 2} : context.end;

        const replacement = `[[${linkText}]]`;
        editor.replaceRange(replacement, context.start, end);
        editor.setCursor({line: context.start.line, ch: context.start.ch + replacement.length});
    }

    /** True if `line` is an item of a block list under `kit:` / `kits:` (a hero with two kits). */
    private isKitListItem(editor: Editor, line: number): boolean {
        if (!/^\s*-\s/.test(editor.getLine(line))) return false;
        for (let i = line - 1; i >= Math.max(0, line - 10); i--) {
            const text = editor.getLine(i);
            if (/^\s*-\s/.test(text)) continue;
            return KIT_FIELD_LINE_REGEX.test(text);
        }
        return false;
    }

    /** True if `line` is inside a fenced code block whose language starts with `ds-`. */
    private isInDseCodeBlock(editor: Editor, line: number): boolean {
        const firstLine = Math.max(0, line - MAX_FENCE_SEARCH_LINES);
        for (let i = line - 1; i >= firstLine; i--) {
            const fence = editor.getLine(i).match(FENCE_REGEX);
            if (fence) {
                // The nearest fence above opens a ds- block; any other fence (closing or another language) means no
                return fence[2].trim().startsWith("ds-");
            }
        }
        return false;
    }
}
