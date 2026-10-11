import {AbstractInputSuggest, App, Modal, setIcon, TFile} from "obsidian";
import {Creature, EnemyGroup, isMinionStatblock} from "@drawSteelAdmonition/EncounterData";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {NoteSuggestion, renderNoteSuggestion, searchStatblocks} from "@utils/NoteLinkSuggest";
import {DSESettings} from "@model/Settings";

/** Suggests statblock notes for a text input. */
class StatblockInputSuggest extends AbstractInputSuggest<NoteSuggestion> {
    private onChoose: (file: TFile) => void;

    constructor(app: App, inputEl: HTMLInputElement, onChoose: (file: TFile) => void) {
        super(app, inputEl);
        this.onChoose = onChoose;
    }

    protected getSuggestions(query: string): NoteSuggestion[] {
        return searchStatblocks(this.app, query);
    }

    renderSuggestion(suggestion: NoteSuggestion, el: HTMLElement): void {
        renderNoteSuggestion(suggestion, el);
    }

    selectSuggestion(suggestion: NoteSuggestion, evt: MouseEvent | KeyboardEvent): void {
        this.setValue(suggestion.file.basename);
        this.onChoose(suggestion.file);
        this.close();
    }
}

interface CreatureRow {
    rowEl: HTMLElement;
    statblockInput: HTMLInputElement;
    countInput: HTMLInputElement;
    infoEl: HTMLElement;
    ref?: string; // [[link]] of the chosen note; unset when the name was typed by hand
}

/**
 * Builds a new enemy group from statblock notes: a group name plus one or more creatures, each a
 * statblock and a count. The group is handed to `onSubmit`, which initializes and saves it.
 */
export class AddEnemyGroupModal extends Modal {
    private resolver: ReferenceResolver;
    private onSubmit: (group: EnemyGroup) => Promise<void>;
    private rows: CreatureRow[] = [];
    private rowsEl: HTMLElement;
    private errorEl: HTMLElement;

    constructor(app: App, settings: DSESettings, onSubmit: (group: EnemyGroup) => Promise<void>) {
        super(app);
        this.resolver = new ReferenceResolver(app, settings);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        contentEl.addClass("ds-add-group-modal");
        contentEl.createEl("h2", {text: "Add Enemy Group"});

        const nameRow = contentEl.createEl("div", {cls: "add-group-name-row"});
        nameRow.createEl("label", {text: "Group name"});
        const nameInput = nameRow.createEl("input", {
            type: "text",
            attr: {placeholder: "Defaults to the first creature's name"},
        });

        contentEl.createEl("div", {cls: "add-group-section-title", text: "Creatures"});
        this.rowsEl = contentEl.createEl("div", {cls: "add-group-rows"});
        this.addRow();

        const addRowButton = contentEl.createEl("button", {cls: "add-group-add-row", text: "Add creature"});
        setIcon(addRowButton.createEl("span", {cls: "add-group-btn-icon"}), "plus");
        addRowButton.addEventListener("click", () => this.addRow().statblockInput.focus());

        contentEl.createEl("div", {
            cls: "add-group-hint",
            text: "Creatures whose statblock role is a minion make the group a squad " +
                "(one minion type, plus an optional captain).",
        });

        this.errorEl = contentEl.createEl("div", {cls: "add-group-error"});

        const buttonContainer = contentEl.createEl("div", {cls: "modal-button-container"});
        const submitButton = buttonContainer.createEl("button", {text: "Add Group", cls: "mod-cta"});
        const cancelButton = buttonContainer.createEl("button", {text: "Cancel"});
        cancelButton.addEventListener("click", () => this.close());
        submitButton.addEventListener("click", async () => {
            const group = this.buildGroup(nameInput.value);
            if (!group) return;

            submitButton.disabled = true;
            this.errorEl.setText("");
            try {
                await this.onSubmit(group);
                this.close();
            } catch (e) {
                this.errorEl.setText(e.message);
                submitButton.disabled = false;
            }
        });

        queueMicrotask(() => this.rows[0]?.statblockInput.focus());
    }

    onClose() {
        this.contentEl.empty();
        this.rows = [];
    }

    private addRow(): CreatureRow {
        const rowEl = this.rowsEl.createEl("div", {cls: "add-group-row"});
        const statblockInput = rowEl.createEl("input", {
            type: "text",
            cls: "add-group-statblock",
            attr: {placeholder: "Search statblocks…"},
        });
        const countInput = rowEl.createEl("input", {
            type: "number",
            cls: "add-group-count",
            attr: {min: "1", title: "Number of creatures"},
        });
        countInput.value = "1";
        const infoEl = rowEl.createEl("div", {cls: "add-group-info"});
        const removeEl = rowEl.createEl("div", {cls: "add-group-remove", attr: {title: "Remove creature"}});
        setIcon(removeEl, "x");

        const row: CreatureRow = {rowEl, statblockInput, countInput, infoEl};
        this.rows.push(row);

        new StatblockInputSuggest(this.app, statblockInput, (file) => {
            row.ref = `[[${this.app.metadataCache.fileToLinktext(file, "", true)}]]`;
            this.showInfo(row);
        });
        // Typing by hand drops the chosen note; the typed name is used as a link instead
        statblockInput.addEventListener("input", () => {
            row.ref = undefined;
            infoEl.empty();
        });
        statblockInput.addEventListener("change", () => {
            if (!row.ref && statblockInput.value.trim()) this.showInfo(row);
        });
        removeEl.addEventListener("click", () => {
            if (this.rows.length === 1) {
                // Keep one row; just clear it
                statblockInput.value = "";
                row.ref = undefined;
                infoEl.empty();
                return;
            }
            this.rows = this.rows.filter((r) => r !== row);
            rowEl.remove();
        });
        return row;
    }

    private rowRef(row: CreatureRow): string {
        return row.ref ?? `[[${row.statblockInput.value.trim()}]]`;
    }

    /** Shows the statblock's stamina and whether it's a minion next to the row. */
    private async showInfo(row: CreatureRow): Promise<void> {
        const ref = this.rowRef(row);
        row.infoEl.empty();
        try {
            const statblock = await this.resolver.resolveReferences(ref);
            if (this.rowRef(row) !== ref) return; // Changed while loading
            row.infoEl.createEl("span", {text: `Stamina ${statblock?.stamina ?? "?"}`});
            if (isMinionStatblock(statblock)) {
                row.infoEl.createEl("span", {cls: "add-group-minion-tag", text: "Minion"});
            }
        } catch (e) {
            if (this.rowRef(row) !== ref) return;
            row.infoEl.createEl("span", {cls: "add-group-info-error", text: "Statblock not found"});
        }
    }

    private buildGroup(nameValue: string): EnemyGroup | null {
        const rows = this.rows.filter((row) => row.statblockInput.value.trim());
        if (rows.length === 0) {
            this.errorEl.setText("Add at least one creature.");
            return null;
        }
        const creatures: Creature[] = [];
        for (const row of rows) {
            const amount = parseInt(row.countInput.value);
            if (isNaN(amount) || amount < 1) {
                this.errorEl.setText(`Count for '${row.statblockInput.value.trim()}' must be at least 1.`);
                return null;
            }
            // Name, stamina, image (and minion role) are filled in from the statblock
            creatures.push({statblock: this.rowRef(row), amount} as Creature);
        }
        return {
            name: nameValue.trim() || rows[0].statblockInput.value.trim(),
            creatures,
        };
    }
}
