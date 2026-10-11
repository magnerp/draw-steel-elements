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

// `statblock:` / `party:` value being typed as a link, e.g. `  - statblock: [[Thorn Dr`
const LINK_FIELD_REGEX = /^\s*(?:-\s*)?(?:statblock|party)\s*:\s*["']?\[\[([^\[\]]*)$/;
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
 * it) or "statblock" in their path.
 */
export function statblockFiles(app: App): TFile[] {
    return app.vault.getMarkdownFiles().filter((file) =>
        app.metadataCache.getFileCache(file)?.frontmatter?.stamina != null || /statblock/i.test(file.path)
    );
}

/** Searches statblock notes, falling back to all notes when no statblock note matches. */
export function searchStatblocks(app: App, query: string): NoteSuggestion[] {
    const results = searchNotes(statblockFiles(app), query);
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
 * when typing `[[` as the value of `statblock:` or `party:` inside a Draw Steel Elements (ds-*) block.
 */
export class NoteLinkSuggest extends EditorSuggest<NoteSuggestion> {
    constructor(app: App) {
        super(app);
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        const beforeCursor = editor.getLine(cursor.line).substring(0, cursor.ch);
        const match = beforeCursor.match(LINK_FIELD_REGEX);
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
        // `statblock:` suggests statblock notes first; `party:` any note
        const isStatblockField = /statblock\s*:/.test(context.editor.getLine(context.start.line));
        return isStatblockField
            ? searchStatblocks(this.app, context.query)
            : searchNotes(this.app.vault.getMarkdownFiles(), context.query);
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
