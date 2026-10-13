import { App, Modal } from 'obsidian';

export class ResetEncounterModal extends Modal {
	private onConfirm: () => void;
	private hasPartySnapshot: boolean;

	constructor(app: App, hasPartySnapshot: boolean, onConfirm: () => void) {
		super(app);
		this.hasPartySnapshot = hasPartySnapshot;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Confirm Encounter Reset' });

		contentEl.createEl('p', { text: 'Are you sure you want to reset the encounter data?  ' +
				'Every creature comes back alive at full stamina (from its statblock note), and all conditions, turns and Malice are cleared. ' +
				(this.hasPartySnapshot
					? 'Heroes from a linked party note or a hero sheet go back to the Stamina and Recoveries saved with "Save Party State".'
					: 'Heroes from a linked party note or a hero sheet keep their Stamina and Recoveries (use "Save Party State" at the start of the encounter to be able to restore them).') });

		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });

		const confirmButton = buttonContainer.createEl('button', { text: 'Yes, Reset', cls: 'mod-warning' });
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
