import {AbstractInputSuggest, App, Modal, Setting} from "obsidian";
import {Hero} from "@drawSteelAdmonition/EncounterData";
import {NoteSuggestion, renderNoteSuggestion, searchNotes} from "@utils/NoteLinkSuggest";
import {Images} from "@utils/Images";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

/** Suggests image files from the vault for a text input. */
class ImageInputSuggest extends AbstractInputSuggest<NoteSuggestion> {
    private onChoose: () => void;

    constructor(app: App, inputEl: HTMLInputElement, onChoose: () => void) {
        super(app, inputEl);
        this.onChoose = onChoose;
    }

    protected getSuggestions(query: string): NoteSuggestion[] {
        const images = this.app.vault.getFiles().filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()));
        return searchNotes(images, query);
    }

    renderSuggestion(suggestion: NoteSuggestion, el: HTMLElement): void {
        renderNoteSuggestion(suggestion, el);
    }

    selectSuggestion(suggestion: NoteSuggestion, evt: MouseEvent | KeyboardEvent): void {
        this.setValue(suggestion.file.path);
        this.onChoose();
        this.close();
    }
}

/**
 * Asks for a new party hero's name, max stamina, and optional max Recoveries and image. The hero entry is
 * handed to `onSubmit`, which saves it; an error it throws is shown in the window.
 */
export class AddHeroModal extends Modal {
    private onSubmit: (hero: Partial<Hero>) => Promise<void>;
    private errorEl: HTMLElement;

    constructor(app: App, onSubmit: (hero: Partial<Hero>) => Promise<void>) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();
        contentEl.addClass("ds-add-hero-modal");
        contentEl.createEl("h2", {text: "Add Hero"});

        let nameInput!: HTMLInputElement;
        let staminaInput!: HTMLInputElement;
        let recoveriesInput!: HTMLInputElement;
        let imageInput!: HTMLInputElement;
        new Setting(contentEl)
            .setName("Name")
            .addText((text) => (nameInput = text.inputEl));
        new Setting(contentEl)
            .setName("Max stamina")
            .addText((text) => {
                staminaInput = text.inputEl;
                staminaInput.type = "number";
                staminaInput.min = "1";
            });
        new Setting(contentEl)
            .setName("Max recoveries")
            .setDesc("Leave empty to not track Recoveries for this hero.")
            .addText((text) => {
                recoveriesInput = text.inputEl;
                recoveriesInput.type = "number";
                recoveriesInput.min = "0";
            });
        const imageSetting = new Setting(contentEl)
            .setName("Image")
            .setDesc("Optional. A vault path, an image name, or a URL.")
            .addText((text) => {
                imageInput = text.inputEl;
                imageInput.placeholder = "Search images…";
            });
        const previewEl = imageSetting.controlEl.createEl("div", {cls: "add-hero-image-preview"});
        imageSetting.controlEl.prepend(previewEl);
        const showPreview = async () => {
            const value = imageInput.value.trim();
            previewEl.empty();
            if (!value) return;
            try {
                const src = await Images.resolveImageSource(this.app, value);
                if (imageInput.value.trim() !== value) return; // Changed while loading
                previewEl.createEl("img", {attr: {src, alt: ""}});
            } catch (e) {
                if (imageInput.value.trim() !== value) return;
                previewEl.createEl("span", {cls: "add-hero-image-error", text: "Not found"});
            }
        };
        new ImageInputSuggest(this.app, imageInput, showPreview);
        imageInput.addEventListener("input", () => previewEl.empty());
        imageInput.addEventListener("change", showPreview);

        this.errorEl = contentEl.createEl("div", {cls: "add-hero-error"});

        const buttonContainer = contentEl.createEl("div", {cls: "modal-button-container"});
        const submitButton = buttonContainer.createEl("button", {text: "Add Hero", cls: "mod-cta"});
        const cancelButton = buttonContainer.createEl("button", {text: "Cancel"});
        cancelButton.addEventListener("click", () => this.close());

        const submit = async () => {
            const hero = this.buildHero(nameInput.value, staminaInput.value, recoveriesInput.value, imageInput.value);
            if (!hero || submitButton.disabled) return;

            submitButton.disabled = true;
            this.errorEl.setText("");
            try {
                await this.onSubmit(hero);
                this.close();
            } catch (e) {
                this.errorEl.setText(e.message);
                submitButton.disabled = false;
            }
        };
        submitButton.addEventListener("click", submit);
        // Not the image field: Enter there picks a suggestion
        [nameInput, staminaInput, recoveriesInput].forEach((input) => {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                }
            });
        });

        queueMicrotask(() => nameInput.focus());
    }

    onClose() {
        this.contentEl.empty();
    }

    private buildHero(nameValue: string, staminaValue: string, recoveriesValue: string, imageValue: string): Partial<Hero> | null {
        const name = nameValue.trim();
        if (!name) {
            this.errorEl.setText("Enter a name.");
            return null;
        }
        const maxStamina = Number(staminaValue);
        if (!staminaValue.trim() || !Number.isInteger(maxStamina) || maxStamina < 1) {
            this.errorEl.setText("Max stamina must be a whole number of at least 1.");
            return null;
        }
        const hero: Partial<Hero> = {name, max_stamina: maxStamina};
        if (recoveriesValue.trim()) {
            const maxRecoveries = Number(recoveriesValue);
            if (!Number.isInteger(maxRecoveries) || maxRecoveries < 0) {
                this.errorEl.setText("Max recoveries must be a whole number of at least 0.");
                return null;
            }
            hero.max_recoveries = maxRecoveries;
        }
        if (imageValue.trim()) {
            hero.image = imageValue.trim();
        }
        return hero;
    }
}
