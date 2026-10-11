import { App, Modal } from 'obsidian';

/** A yes/cancel confirmation dialog for destructive actions. */
export class ConfirmModal extends Modal {
	private title: string;
	private message: string;
	private confirmText: string;
	private onConfirm: () => void;

	constructor(app: App, title: string, message: string, confirmText: string, onConfirm: () => void) {
		super(app);
		this.title = title;
		this.message = message;
		this.confirmText = confirmText;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.title });
		contentEl.createEl('p', { text: this.message });

		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });

		const confirmButton = buttonContainer.createEl('button', { text: this.confirmText, cls: 'mod-warning' });
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });

		confirmButton.addEventListener('click', () => {
			this.onConfirm();
			this.close();
		});

		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
