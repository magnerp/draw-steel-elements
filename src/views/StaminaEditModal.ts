import { App, Modal, setIcon } from "obsidian";
import {StaminaBar} from "@model/StaminaBar";
import {Stamina, StaminaStatus} from "@utils/Stamina";
import {actionForEvent, currentHotkeyFor, modifiersOfEvent, modifiersOfHotkey} from "@utils/Hotkeys";

// Tracked recoveries of a hero (only heroes with max_recoveries have them)
export interface RecoveryInfo {
	current: number;
	max: number;
	value: number;
}

export interface StaminaEditResult {
	recoveriesSpent: number;
}

const STATUS_LABELS: Partial<Record<StaminaStatus, string>> = { winded: 'Winded', dying: 'Dying', dead: 'Dead' };

/**
 * Damage, healing and temporary stamina of one hero or creature. Changes add up as pending changes, shown on the
 * bar, and nothing is saved until Apply.
 *
 * Keyboard: in the Amount field, Enter deals the number as damage and Shift+Enter heals it (both save; the keys
 * are set in the settings). Ctrl+Enter applies from anywhere, Escape cancels.
 */
export class StaminaEditModal extends Modal {
	private staminaBar: StaminaBar;
	private isHero: boolean;
	private name: string;
	private updateCallback: (result: StaminaEditResult) => void;
	// Winded doesn't apply to minions (squad_role: minion)
	private showWinded: boolean;
	private recovery?: RecoveryInfo;

	private maxStamina: number;
	private currentStamina: number;
	private currentTempStamina: number;
	private negativeStaminaLimit: number;

	// Pending changes, applied on save
	private pendingStaminaChange = 0;
	private pendingTempStaminaChange = 0;
	private pendingRecoveriesSpent = 0;
	// What the amount would do, shown on the bar but not applied: while hovering Damage or Heal, or typing the amount
	// (Enter deals it as damage)
	private hoverPreview: 'damage' | 'heal' | null = null;
	// Modifier keys held in the amount field ("Shift", "Ctrl+Shift"): holding the healing shortcut's previews healing
	private heldModifiers = '';

	private els: {
		root: HTMLElement;
		before: HTMLElement;
		after: HTMLElement;
		temp: HTMLElement;
		statusTag: HTMLElement;
		delta: HTMLElement;
		fill: HTMLElement;
		change: HTMLElement;
		previewChange: HTMLElement;
		amount: HTMLInputElement;
		damage: HTMLButtonElement;
		heal: HTMLButtonElement;
		staminaInput: HTMLInputElement;
		tempInput: HTMLInputElement;
		recoveryButton: HTMLButtonElement;
		recoveryText: HTMLElement;
		summary: HTMLElement;
		reset: HTMLButtonElement;
		apply: HTMLButtonElement;
	};

	constructor(
		app: App,
		staminaBar: StaminaBar,
		isHero: boolean,
		name: string,
		updateCallback: (result: StaminaEditResult) => void,
		showWinded: boolean = true,
		recovery?: RecoveryInfo
	) {
		super(app);
		this.staminaBar = staminaBar;
		this.isHero = isHero;
		this.name = name;
		this.updateCallback = updateCallback;
		this.showWinded = showWinded;
		this.recovery = recovery;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('ds-stam-modal-container');

		this.maxStamina = this.staminaBar.max_stamina;
		this.currentStamina = this.staminaBar.current_stamina ?? this.maxStamina;
		this.currentTempStamina = this.staminaBar.temp_stamina ?? 0;
		this.negativeStaminaLimit = Stamina.minimumStamina(this.maxStamina, this.isHero);

		const root = contentEl.createEl('div', { cls: 'ds-stam-modal' });

		const headerEl = root.createEl('div', { cls: 'ds-stam-header' });
		headerEl.createEl('h2', { text: 'Stamina' });
		if (this.name) headerEl.createEl('div', { cls: 'ds-stam-subtitle', text: this.name });

		// Summary: stamina before and after the pending changes, and the bar
		const summaryEl = root.createEl('div', { cls: 'ds-stam-summary' });
		const valuesEl = summaryEl.createEl('div', { cls: 'ds-stam-values' });
		const before = valuesEl.createSpan({ cls: 'ds-stam-before' });
		valuesEl.createSpan({ cls: 'ds-stam-arrow', text: '→' });
		const after = valuesEl.createSpan({ cls: 'ds-stam-after' });
		valuesEl.createSpan({ cls: 'ds-stam-max', text: `/${this.maxStamina}` });
		const temp = valuesEl.createSpan({ cls: 'ds-stam-temp', attr: { title: 'Temporary Stamina' } });
		const statusTag = valuesEl.createSpan({ cls: 'ds-stam-status-tag' });
		const delta = valuesEl.createSpan({ cls: 'ds-stam-delta' });

		const meterEl = summaryEl.createEl('div', { cls: 'ds-stam-meter' });
		const fill = meterEl.createEl('div', { cls: 'ds-stam-meter-fill' });
		const change = meterEl.createEl('div', { cls: 'ds-stam-meter-change' });
		const previewChange = meterEl.createEl('div', { cls: 'ds-stam-meter-change is-preview' });

		// Zones: dying (heroes, below 0) and winded (1 up to half of max), shaded on the bar and labeled under it
		// (minions have neither)
		const zones: { cls: string; from: number; to: number; text: string; title: string }[] = [];
		if (this.isHero && this.negativeStaminaLimit < 0) {
			zones.push({ cls: 'is-dying', from: this.negativeStaminaLimit, to: 0, text: 'Dying',
				title: `Dying at 0 or less, dead at ${this.negativeStaminaLimit}` });
		}
		const windedThreshold = Stamina.windedThreshold(this.maxStamina);
		if (this.showWinded && windedThreshold > 0) {
			zones.push({ cls: 'is-winded', from: 0, to: windedThreshold, text: `Winded ≤ ${windedThreshold}`,
				title: `Winded at ${windedThreshold} or less` });
		}
		if (zones.length > 0) {
			const zonesEl = summaryEl.createEl('div', { cls: 'ds-stam-zones' });
			zones.forEach((zone) => {
				const left = `${this.position(zone.from)}%`;
				const width = `${this.position(zone.to) - this.position(zone.from)}%`;
				const shadeEl = meterEl.createEl('div', { cls: `ds-stam-zone ${zone.cls}` });
				shadeEl.style.left = left;
				shadeEl.style.width = width;
				const labelEl = zonesEl.createEl('div', { cls: `ds-stam-zone-label ${zone.cls}`, text: zone.text, attr: { title: zone.title } });
				labelEl.style.left = left;
				labelEl.style.width = width;
			});
		}

		// Damage or heal by an amount
		root.createEl('div', { cls: 'ds-stam-label', text: 'Damage or heal' });
		const amountRow = root.createEl('div', { cls: 'ds-stam-amount-row' });
		const amount = amountRow.createEl('input', {
			cls: 'ds-stam-amount',
			attr: { type: 'number', min: '0', 'aria-label': 'Amount' },
		});
		amount.value = '0';
		['input', 'focus', 'blur'].forEach((type) => amount.addEventListener(type, () => this.render()));
		const trackModifiers = (e: KeyboardEvent | FocusEvent) => {
			const held = e instanceof KeyboardEvent ? modifiersOfEvent(e) : '';
			if (held === this.heldModifiers) return;
			this.heldModifiers = held;
			this.render();
		};
		amount.addEventListener('keydown', trackModifiers);
		amount.addEventListener('keyup', trackModifiers);
		amount.addEventListener('blur', trackModifiers);
		const damage = this.actionButton(amountRow, 'sword', 'Damage', currentHotkeyFor('applyDamage'), 'is-damage');
		damage.title = 'Temporary Stamina takes the damage first';
		damage.addEventListener('click', () => this.applyDamage());
		this.previewOn(damage, 'damage');
		const heal = this.actionButton(amountRow, 'heart-pulse', 'Heal', currentHotkeyFor('applyHealing'), 'is-heal');
		heal.addEventListener('click', () => this.applyHealing());
		this.previewOn(heal, 'heal');

		// Set the values directly
		root.createEl('div', { cls: 'ds-stam-label', text: 'Set' });
		const setRow = root.createEl('div', { cls: 'ds-stam-set-row' });
		const staminaInput = this.stepper(setRow, 'Stamina', `/${this.maxStamina}`,
			(step) => {
				this.pendingStaminaChange += step > 0
					? Math.min(1, this.amountToMaxStamina())
					: -Math.min(1, this.amountToDeath());
			},
			(value) => { this.pendingStaminaChange = value - this.currentStamina; });
		const tempInput = this.stepper(setRow, 'Temporary', '',
			(step) => {
				if (step < 0 && this.resultingTemp() <= 0) return;
				this.pendingTempStaminaChange += step;
			},
			(value) => { this.pendingTempStaminaChange = Math.max(0, value) - this.currentTempStamina; },
			'is-temp');
		tempInput.min = '0';

		// One-click changes
		const quickRow = root.createEl('div', { cls: 'ds-stam-quick-row' });
		this.quickButton(quickRow, 'skull', 'Kill').addEventListener('click', () => {
			this.pendingStaminaChange = this.negativeStaminaLimit - this.currentStamina;
			this.pendingTempStaminaChange = -this.currentTempStamina;
			this.render();
		});
		this.quickButton(quickRow, 'sparkles', 'Full heal').addEventListener('click', () => {
			this.pendingStaminaChange = this.maxStamina - this.currentStamina;
			this.pendingTempStaminaChange = -this.currentTempStamina;
			this.render();
		});
		const recoveryButton = this.quickButton(quickRow, 'syringe', '');
		const recoveryText = recoveryButton.querySelector<HTMLElement>('.ds-stam-quick-text')!;
		recoveryButton.addEventListener('click', () => this.spendRecovery());

		// Footer: hints, what will change, buttons
		const footerEl = root.createEl('div', { cls: 'ds-stam-footer' });
		const hintsEl = footerEl.createEl('div', { cls: 'ds-stam-hints' });
		const hints = [
			[currentHotkeyFor('applyDamage'), 'damage & apply'],
			[currentHotkeyFor('applyHealing'), 'heal & apply'],
			['Ctrl+Enter', 'apply'],
			['Esc', 'cancel'],
		].filter(([key]) => key);
		hints.forEach(([key, what]) => {
			const hintEl = hintsEl.createSpan();
			hintEl.createEl('kbd', { text: key });
			hintEl.appendText(` ${what}`);
		});
		const summary = footerEl.createEl('div', { cls: 'ds-stam-changes' });
		const buttonsEl = footerEl.createEl('div', { cls: 'ds-stam-buttons' });
		const reset = buttonsEl.createEl('button', { text: 'Reset' });
		reset.addEventListener('click', () => {
			this.pendingStaminaChange = 0;
			this.pendingTempStaminaChange = 0;
			this.pendingRecoveriesSpent = 0;
			this.render();
		});
		buttonsEl.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		const apply = buttonsEl.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		apply.addEventListener('click', () => this.save());

		this.els = {
			root, before, after, temp, statusTag, delta, fill, change, previewChange, amount, damage, heal,
			staminaInput, tempInput, recoveryButton, recoveryText, summary, reset, apply,
		};

		// Amount-field shortcuts (Enter / Shift+Enter by default): apply the number as damage or healing and save
		amount.addEventListener('keydown', (e) => {
			const action = actionForEvent(e, 'stamina');
			if (action !== 'applyDamage' && action !== 'applyHealing') return;
			e.preventDefault();
			e.stopPropagation();
			if (action === 'applyDamage') this.applyDamage();
			else this.applyHealing();
			this.save();
		});

		// Ctrl+Enter applies from anywhere in the window
		root.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.save();
			}
		});

		this.render();

		// Focus the amount once we have loaded, with the value selected so typing replaces the 0
		queueMicrotask(() => { amount.focus(); amount.select(); });
	}

	// ---------------------------------------------------------------------------------------------
	// Building
	// ---------------------------------------------------------------------------------------------

	private actionButton(parent: HTMLElement, icon: string, text: string, hotkey: string, cls: string): HTMLButtonElement {
		const button = parent.createEl('button', { cls: `ds-stam-action ${cls}` });
		setIcon(button.createSpan({ cls: 'ds-stam-action-icon' }), icon);
		button.createSpan({ cls: 'ds-stam-action-text', text });
		if (hotkey) button.createEl('kbd', { text: hotkey });
		return button;
	}

	/** Hovering or focusing the button shows what it would do on the bar. */
	private previewOn(button: HTMLElement, preview: 'damage' | 'heal') {
		const show = () => { this.hoverPreview = preview; this.render(); };
		const hide = () => {
			if (this.hoverPreview !== preview) return;
			this.hoverPreview = null;
			this.render();
		};
		button.addEventListener('mouseenter', show);
		button.addEventListener('focus', show);
		button.addEventListener('mouseleave', hide);
		button.addEventListener('blur', hide);
	}

	private quickButton(parent: HTMLElement, icon: string, text: string): HTMLButtonElement {
		const button = parent.createEl('button', { cls: 'ds-stam-quick' });
		setIcon(button.createSpan({ cls: 'ds-stam-quick-icon' }), icon);
		button.createSpan({ cls: 'ds-stam-quick-text', text });
		return button;
	}

	/** A labeled number field with − and + buttons. */
	private stepper(parent: HTMLElement, label: string, suffix: string, onStep: (step: number) => void,
					onInput: (value: number) => void, cls = ''): HTMLInputElement {
		const el = parent.createEl('div', { cls: `ds-stam-stepper ${cls}` });
		el.createEl('div', { cls: 'ds-stam-stepper-label', text: label });
		const body = el.createEl('div', { cls: 'ds-stam-stepper-body' });
		const minus = body.createEl('button', { cls: 'ds-stam-step', attr: { 'aria-label': `Lower ${label}` } });
		setIcon(minus, 'minus');
		const input = body.createEl('input', { cls: 'ds-stam-stepper-input', attr: { type: 'number', 'aria-label': label } });
		if (suffix) body.createSpan({ cls: 'ds-stam-stepper-suffix', text: suffix });
		const plus = body.createEl('button', { cls: 'ds-stam-step', attr: { 'aria-label': `Raise ${label}` } });
		setIcon(plus, 'plus');

		minus.addEventListener('click', () => { onStep(-1); this.render(); });
		plus.addEventListener('click', () => { onStep(1); this.render(); });
		input.addEventListener('input', () => {
			const value = parseInt(input.value);
			if (isNaN(value)) return;
			onInput(value);
			// Don't rewrite the field being typed in
			this.render(input);
		});
		return input;
	}

	// ---------------------------------------------------------------------------------------------
	// Changes
	// ---------------------------------------------------------------------------------------------

	private amountValue(): number {
		const value = parseInt(this.els.amount.value);
		return isNaN(value) ? NaN : Math.max(0, value);
	}

	/** The change dealing the amount as damage or healing would add. Temporary stamina takes the damage first. */
	private amountChange(kind: 'damage' | 'heal'): { stamina: number; temp: number } {
		const adjustment = this.amountValue();
		if (isNaN(adjustment)) return { stamina: 0, temp: 0 };
		if (kind === 'heal') return { stamina: Math.min(adjustment, this.amountToMaxStamina()), temp: 0 };
		const tempStaminaUsed = Math.min(adjustment, this.resultingTemp());
		return { stamina: -Math.min(adjustment - tempStaminaUsed, this.amountToDeath()), temp: -tempStaminaUsed };
	}

	private applyAmount(kind: 'damage' | 'heal') {
		const change = this.amountChange(kind);
		this.pendingStaminaChange += change.stamina;
		this.pendingTempStaminaChange += change.temp;
		// Still hovering: the next preview starts from here, after the button is left
		this.hoverPreview = null;
		this.render();
	}

	private applyDamage() {
		this.applyAmount('damage');
	}

	private applyHealing() {
		this.applyAmount('heal');
	}

	/** The preview in effect: the hovered button, else damage while typing a number in the amount field. */
	private currentPreview(): 'damage' | 'heal' | null {
		if (this.hoverPreview) return this.hoverPreview;
		const typing = activeDocument.activeElement === this.els.amount && this.amountValue() > 0;
		if (!typing) return null;
		// Holding the healing shortcut's modifiers (Shift by default) previews healing, else damage
		const healing = currentHotkeyFor('applyHealing');
		if (healing && this.heldModifiers && modifiersOfHotkey(healing) === this.heldModifiers) return 'heal';
		return currentHotkeyFor('applyDamage') ? 'damage' : null;
	}

	private spendRecovery() {
		if (this.recovery && this.recoveriesLeft() <= 0) return;
		this.pendingStaminaChange += this.recovery ? this.recovery.value : Math.floor(this.maxStamina / 3);
		if (this.recovery) this.pendingRecoveriesSpent += 1;
		this.render();
	}

	private hasChanges(): boolean {
		return this.pendingStaminaChange !== 0 || this.pendingTempStaminaChange !== 0 || this.pendingRecoveriesSpent !== 0;
	}

	private save() {
		if (!this.hasChanges()) {
			this.close();
			return;
		}
		this.staminaBar.current_stamina = this.resultingStamina();
		this.staminaBar.temp_stamina = this.resultingTemp();
		this.updateCallback({ recoveriesSpent: this.pendingRecoveriesSpent });
		this.close();
	}

	private clampStamina(stamina: number): number {
		return Math.max(this.negativeStaminaLimit, Math.min(stamina, this.maxStamina));
	}

	private resultingStamina(): number {
		return this.clampStamina(this.currentStamina + this.pendingStaminaChange);
	}

	private resultingTemp(): number {
		return this.currentTempStamina + this.pendingTempStaminaChange;
	}

	private recoveriesLeft(): number {
		return this.recovery ? this.recovery.current - this.pendingRecoveriesSpent : 0;
	}

	private amountToMaxStamina() {
		return this.maxStamina - this.currentStamina - this.pendingStaminaChange;
	}

	private amountToDeath() {
		return this.currentStamina + this.pendingStaminaChange - this.negativeStaminaLimit;
	}

	/** Where a stamina value sits on the bar, which runs from the lowest stamina to max, in percent. */
	private position(stamina: number): number {
		const length = this.maxStamina - this.negativeStaminaLimit;
		if (length <= 0) return 0;
		return Math.max(0, Math.min(100, (stamina - this.negativeStaminaLimit) / length * 100));
	}

	// ---------------------------------------------------------------------------------------------
	// Display
	// ---------------------------------------------------------------------------------------------

	/** Shows the pending changes everywhere, except in `editing` (the field being typed in). */
	private render(editing?: HTMLInputElement) {
		const els = this.els;
		// Committed: the pending changes. Shown: those plus the preview, if any.
		const committed = this.resultingStamina();
		const committedTemp = this.resultingTemp();
		const preview = this.currentPreview();
		const previewChange = preview ? this.amountChange(preview) : { stamina: 0, temp: 0 };
		const resulting = this.clampStamina(committed + previewChange.stamina);
		const resultingTemp = committedTemp + previewChange.temp;
		const change = resulting - this.currentStamina;
		const tempChanged = resultingTemp !== this.currentTempStamina;
		els.root.toggleClass('is-previewing', previewChange.stamina !== 0 || previewChange.temp !== 0);

		let status = Stamina.status(resulting, this.maxStamina, this.isHero);
		if (status === 'winded' && !this.showWinded) status = 'healthy';
		(['healthy', 'winded', 'dying', 'dead'] as StaminaStatus[]).forEach((s) => els.root.toggleClass(`is-${s}`, s === status));
		els.root.toggleClass('is-damage', change < 0);
		els.root.toggleClass('is-heal', change > 0);

		// Numbers
		els.before.setText(`${this.currentStamina}`);
		els.after.setText(`${resulting}`);
		els.root.toggleClass('has-change', change !== 0);
		els.temp.toggleClass('is-hidden', this.currentTempStamina === 0 && resultingTemp === 0);
		els.temp.setText(tempChanged
			? `+${this.currentTempStamina} → +${resultingTemp}`
			: `+${resultingTemp}`);
		const label = STATUS_LABELS[status];
		els.statusTag.toggleClass('is-hidden', !label);
		els.statusTag.setText(label ?? '');
		els.delta.setText(change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '');

		// Bar: what's left, then what the pending change takes away or adds, then what the preview would
		const low = Math.min(this.currentStamina, committed, resulting);
		const zero = this.isHero ? this.position(0) : 0;
		const fillFrom = low > 0 ? zero : this.position(low);
		const fillTo = low > 0 ? this.position(low) : zero;
		els.fill.style.left = `${fillFrom}%`;
		els.fill.style.width = `${fillTo - fillFrom}%`;
		this.setSegment(els.change, this.currentStamina, committed);
		this.setSegment(els.previewChange, committed, resulting);

		// Fields (the pending changes, without the preview)
		if (editing !== els.staminaInput) els.staminaInput.value = `${committed}`;
		if (editing !== els.tempInput) els.tempInput.value = `${committedTemp}`;

		// Recoveries
		if (this.recovery) {
			const left = this.recoveriesLeft();
			els.recoveryText.setText(`Recovery ${left}/${this.recovery.max}`);
			els.recoveryButton.disabled = left <= 0;
			els.recoveryButton.title = left > 0
				? `Regain ${this.recovery.value} stamina and use up one Recovery`
				: 'No Recoveries left';
		} else {
			els.recoveryText.setText('Recovery');
			els.recoveryButton.title = `Regain ${Math.floor(this.maxStamina / 3)} stamina (a third of max)`;
		}

		// What will change (the pending changes, without the preview)
		const pendingChange = committed - this.currentStamina;
		els.summary.empty();
		if (pendingChange < 0) els.summary.createSpan({ cls: 'is-damage', text: `−${-pendingChange} Stamina` });
		if (pendingChange > 0) els.summary.createSpan({ cls: 'is-heal', text: `+${pendingChange} Stamina` });
		if (this.pendingTempStaminaChange !== 0) {
			const tempChange = this.pendingTempStaminaChange;
			els.summary.createSpan({ cls: 'is-temp', text: `${tempChange > 0 ? '+' : '−'}${Math.abs(tempChange)} Temp` });
		}
		if (this.pendingRecoveriesSpent > 0) {
			const spent = this.pendingRecoveriesSpent;
			els.summary.createSpan({ text: `${spent} ${spent === 1 ? 'Recovery' : 'Recoveries'}` });
		}
		if (!this.hasChanges()) els.summary.createSpan({ text: 'No changes' });

		els.reset.disabled = !this.hasChanges();
		els.apply.disabled = !this.hasChanges();
	}

	/** Marks the part of the bar between two stamina values as damage (going down) or healing (going up). */
	private setSegment(el: HTMLElement, from: number, to: number) {
		const left = this.position(Math.min(from, to));
		el.style.left = `${left}%`;
		el.style.width = `${this.position(Math.max(from, to)) - left}%`;
		el.toggleClass('is-damage', to < from);
		el.toggleClass('is-heal', to > from);
	}
}
