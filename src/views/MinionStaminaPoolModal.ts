import { App, Modal, MarkdownPostProcessorContext, setIcon } from "obsidian";
import { Creature, CreatureInstance, EncounterData, EnemyGroup, Condition } from "@drawSteelAdmonition/EncounterData";
import { ConditionManager } from "@utils/Conditions";
import { CodeBlocks } from "@utils/CodeBlocks";
import { actionForEvent, currentHotkeyFor, modifiersOfEvent, modifiersOfHotkey } from "@utils/Hotkeys";

type Preview = 'damage' | 'heal';

/**
 * The shared stamina pool of a minion squad. Damage is dealt to a number of minions at once; each time the pool
 * drops past a minion's worth of stamina, one minion dies and has to be picked. Nothing is saved until Apply.
 *
 * Keyboard: in the amount fields, Enter deals the damage and saves (or moves to the minions when some have to be
 * picked), Shift+Enter heals the pool by the amount (the keys are set in the settings). Elsewhere, Enter saves.
 * Ctrl+Enter applies from anywhere, Escape cancels.
 */
export class MinionStaminaPoolModal extends Modal {
	private group: EnemyGroup;
	private creature: Creature; // Minion creature
	private data: EncounterData;
	private ctx: MarkdownPostProcessorContext;
	private updateCallback: () => void;

	private minionMaxStamina: number;
	private aliveMinions: CreatureInstance[];
	private poolMaxStamina: number;
	private poolCurrentStamina: number;

	// Pending changes, applied on save
	private pendingStaminaChange = 0;
	private picked = new Set<CreatureInstance>();
	// What the amount would do, shown but not applied: while hovering Damage or Heal, or typing in the amount fields
	private hoverPreview: Preview | null = null;
	// Modifier keys held in the amount fields: holding the healing shortcut's previews healing
	private heldModifiers = '';

	private els: {
		root: HTMLElement;
		before: HTMLElement;
		after: HTMLElement;
		killsTag: HTMLElement;
		delta: HTMLElement;
		fill: HTMLElement;
		change: HTMLElement;
		previewChange: HTMLElement;
		minionsLeft: HTMLElement;
		amount: HTMLInputElement;
		count: HTMLInputElement;
		poolInput: HTMLInputElement;
		pickInfo: HTMLElement;
		minions: { instance: CreatureInstance; el: HTMLElement }[];
		summary: HTMLElement;
		reset: HTMLButtonElement;
		apply: HTMLButtonElement;
	};

	constructor(
		app: App,
		group: EnemyGroup,
		creature: Creature,
		data: EncounterData,
		ctx: MarkdownPostProcessorContext,
		updateCallback: () => void
	) {
		super(app);
		this.group = group;
		this.creature = creature;
		this.data = data;
		this.ctx = ctx;
		this.updateCallback = updateCallback;
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('ds-stam-modal-container');

		this.minionMaxStamina = this.creature.max_stamina;
		this.aliveMinions = this.creature.instances?.filter((inst) => !inst.isDead) ?? [];
		this.poolMaxStamina = this.aliveMinions.length * this.minionMaxStamina;
		this.poolCurrentStamina = this.group.minion_stamina_pool ?? this.poolMaxStamina;

		const root = contentEl.createEl('div', { cls: 'ds-stam-modal ds-pool-modal' });

		const headerEl = root.createEl('div', { cls: 'ds-stam-header' });
		headerEl.createEl('h2', { text: 'Stamina pool' });
		headerEl.createEl('div', { cls: 'ds-stam-subtitle', text: this.group.name });

		// Summary: the pool before and after the pending changes, and the bar split into minions
		const summaryEl = root.createEl('div', { cls: 'ds-stam-summary' });
		const valuesEl = summaryEl.createEl('div', { cls: 'ds-stam-values' });
		const before = valuesEl.createSpan({ cls: 'ds-stam-before' });
		valuesEl.createSpan({ cls: 'ds-stam-arrow', text: '→' });
		const after = valuesEl.createSpan({ cls: 'ds-stam-after' });
		valuesEl.createSpan({ cls: 'ds-stam-max', text: `/${this.poolMaxStamina}` });
		const killsTag = valuesEl.createSpan({ cls: 'ds-stam-status-tag ds-pool-kills' });
		const delta = valuesEl.createSpan({ cls: 'ds-stam-delta' });

		const meterEl = summaryEl.createEl('div', { cls: 'ds-stam-meter' });
		const fill = meterEl.createEl('div', { cls: 'ds-stam-meter-fill' });
		const change = meterEl.createEl('div', { cls: 'ds-stam-meter-change' });
		const previewChange = meterEl.createEl('div', { cls: 'ds-stam-meter-change is-preview' });
		// Where each minion dies
		for (let i = 1; i < this.aliveMinions.length; i++) {
			meterEl.createEl('div', { cls: 'ds-pool-tick' }).style.left = `${this.position(i * this.minionMaxStamina)}%`;
		}

		const minionsLeft = summaryEl.createEl('div', { cls: 'ds-pool-left' });

		// Damage some minions, or heal the pool
		root.createEl('div', { cls: 'ds-stam-label', text: 'Damage or heal' });
		const amountRow = root.createEl('div', { cls: 'ds-stam-amount-row' });
		const amount = amountRow.createEl('input', {
			cls: 'ds-stam-amount',
			attr: { type: 'number', min: '0', 'aria-label': 'Amount' },
		});
		amount.value = '0';
		const countEl = amountRow.createEl('label', { cls: 'ds-pool-count' });
		countEl.createSpan({ text: '×' });
		const count = countEl.createEl('input', {
			attr: { type: 'number', min: '0', max: `${this.aliveMinions.length}`, 'aria-label': 'Minions damaged' },
		});
		count.value = '1';
		countEl.createSpan({ text: 'minions' });

		const damage = this.actionButton(amountRow, 'sword', 'Damage', currentHotkeyFor('applyDamage'), 'is-damage');
		damage.title = 'Deal the amount to each of the minions';
		damage.addEventListener('click', () => this.applyAmount('damage'));
		this.previewOn(damage, 'damage');
		const heal = this.actionButton(amountRow, 'heart-pulse', 'Heal', currentHotkeyFor('applyHealing'), 'is-heal');
		heal.title = 'Heal the pool by the amount (minions usually can\'t regain Stamina)';
		heal.addEventListener('click', () => this.applyAmount('heal'));
		this.previewOn(heal, 'heal');

		[amount, count].forEach((input) => {
			['input', 'focus'].forEach((type) => input.addEventListener(type, () => this.render()));
			const trackModifiers = (e: KeyboardEvent | FocusEvent) => {
				const held = e instanceof KeyboardEvent ? modifiersOfEvent(e) : '';
				if (held === this.heldModifiers && e.type !== 'blur') return;
				this.heldModifiers = held;
				this.render();
			};
			input.addEventListener('keydown', trackModifiers);
			input.addEventListener('keyup', trackModifiers);
			input.addEventListener('blur', trackModifiers);
		});

		// Set the pool directly
		root.createEl('div', { cls: 'ds-stam-label', text: 'Set' });
		const setRow = root.createEl('div', { cls: 'ds-stam-set-row' });
		const poolInput = this.stepper(setRow, 'Pool', `/${this.poolMaxStamina}`);

		// The minions, to pick which ones die
		const minionsLabel = root.createEl('div', { cls: 'ds-stam-label ds-pool-minions-label' });
		minionsLabel.createSpan({ text: 'Minions' });
		const pickInfo = minionsLabel.createSpan({ cls: 'ds-pool-pick-info' });
		const gridEl = root.createEl('div', { cls: 'ds-pool-minions' });
		const minions = this.aliveMinions.map((instance) => {
			// One Tab stop for the grid: the arrow keys move between the minions
			const el = gridEl.createEl('div', { cls: 'ds-pool-minion', attr: { role: 'checkbox', tabindex: '-1' } });
			const markEl = el.createSpan({ cls: 'ds-pool-minion-mark' });
			setIcon(markEl, 'skull');
			el.createSpan({ cls: 'ds-pool-minion-name', text: `${this.creature.name} #${instance.id}` });
			const conditionsEl = el.createSpan({ cls: 'ds-pool-minion-conditions' });
			this.buildConditionIcons(conditionsEl, instance, this.data, this.ctx);
			el.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).closest('.ds-pool-condition')) return;
				this.togglePick(instance);
			});
			el.addEventListener('keydown', (e) => {
				const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
				if (e.key === ' ') {
					e.preventDefault();
					this.togglePick(instance);
				} else if (arrows[e.key]) {
					e.preventDefault();
					const target = this.neighbor(el, ...arrows[e.key]);
					if (target) this.focusMinion(target);
				}
			});
			el.addEventListener('focus', () => this.focusMinion(el));
			return { instance, el };
		});
		minions[0]?.el.setAttr('tabindex', '0');

		// Footer: hints, what will change, buttons
		const footerEl = root.createEl('div', { cls: 'ds-stam-footer' });
		const hintsEl = footerEl.createEl('div', { cls: 'ds-stam-hints' });
		[
			[currentHotkeyFor('applyDamage'), 'damage & apply'],
			[currentHotkeyFor('applyHealing'), 'heal'],
			['↑↓←→', 'move'],
			['Space', 'pick minion'],
			['Ctrl+Enter', 'apply'],
			['Esc', 'cancel'],
		].filter(([key]) => key).forEach(([key, what]) => {
			const hintEl = hintsEl.createSpan();
			hintEl.createEl('kbd', { text: key });
			hintEl.appendText(` ${what}`);
		});
		const summary = footerEl.createEl('div', { cls: 'ds-stam-changes' });
		const buttonsEl = footerEl.createEl('div', { cls: 'ds-stam-buttons' });
		const reset = buttonsEl.createEl('button', { text: 'Reset' });
		reset.addEventListener('click', () => {
			this.pendingStaminaChange = 0;
			this.picked.clear();
			amount.value = '0';
			count.value = '1';
			this.render();
		});
		buttonsEl.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		const apply = buttonsEl.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		apply.addEventListener('click', () => this.save());

		this.els = {
			root, before, after, killsTag, delta, fill, change, previewChange, minionsLeft, amount, count,
			poolInput, pickInfo, minions, summary, reset, apply,
		};

		// Shortcuts (Enter / Shift+Enter by default). In the amount fields, Enter deals the damage and saves; when
		// minions die it moves to them instead, and Enter saves once they're picked. Shift+Enter heals the pool by
		// the amount. Ctrl+Enter saves from anywhere.
		root.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.save();
				return;
			}
			const action = actionForEvent(e, 'stamina');
			if (action !== 'applyDamage' && action !== 'applyHealing') return;
			e.preventDefault();
			e.stopPropagation();
			const inAmountFields = e.target === amount || e.target === count;
			if (!inAmountFields) {
				if (action === 'applyDamage') this.save();
				return;
			}
			this.applyAmount(action === 'applyDamage' ? 'damage' : 'heal');
			if (this.canSave()) {
				this.save();
			} else {
				// Minions have to be picked first
				const first = this.els.minions.find(({ el }) => !el.hasClass('is-disabled'));
				if (first) this.focusMinion(first.el);
			}
		});

		this.render();

		// Focus the amount, with the value selected so typing replaces the 0
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

	/** Hovering or focusing the button shows what it would do. */
	private previewOn(button: HTMLElement, preview: Preview) {
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

	/** Focuses a minion and makes it the grid's Tab stop. */
	private focusMinion(el: HTMLElement) {
		this.els.minions.forEach((minion) => minion.el.setAttr('tabindex', minion.el === el ? '0' : '-1'));
		if (activeDocument.activeElement !== el) el.focus();
	}

	/** The minion next to `from` in a direction, by on-screen position (the grid wraps). */
	private neighbor(from: HTMLElement, dx: number, dy: number): HTMLElement | null {
		const all = this.els.minions.map(({ el }) => el);
		if (dx !== 0) return all[all.indexOf(from) + dx] ?? null;
		const origin = from.getBoundingClientRect();
		const originX = origin.left + origin.width / 2;
		let best: HTMLElement | null = null;
		let bestScore = Infinity;
		all.forEach((el) => {
			const rect = el.getBoundingClientRect();
			const rowDistance = (rect.top - origin.top) * dy;
			if (rowDistance <= 4) return;
			const score = rowDistance * 1000 + Math.abs(rect.left + rect.width / 2 - originX);
			if (score < bestScore) {
				bestScore = score;
				best = el;
			}
		});
		return best;
	}

	/** The pool as a number field with − and + buttons. */
	private stepper(parent: HTMLElement, label: string, suffix: string): HTMLInputElement {
		const el = parent.createEl('div', { cls: 'ds-stam-stepper' });
		el.createEl('div', { cls: 'ds-stam-stepper-label', text: label });
		const body = el.createEl('div', { cls: 'ds-stam-stepper-body' });
		const minus = body.createEl('button', { cls: 'ds-stam-step', attr: { 'aria-label': `Lower ${label}` } });
		setIcon(minus, 'minus');
		const input = body.createEl('input', { cls: 'ds-stam-stepper-input', attr: { type: 'number', 'aria-label': label } });
		body.createSpan({ cls: 'ds-stam-stepper-suffix', text: suffix });
		const plus = body.createEl('button', { cls: 'ds-stam-step', attr: { 'aria-label': `Raise ${label}` } });
		setIcon(plus, 'plus');

		const step = (by: number) => {
			this.pendingStaminaChange += by;
			this.clampPendingChange();
			this.render();
		};
		minus.addEventListener('click', () => step(-1));
		plus.addEventListener('click', () => step(1));
		input.addEventListener('input', () => {
			const value = parseInt(input.value);
			if (isNaN(value)) return;
			this.pendingStaminaChange = value - this.poolCurrentStamina;
			this.clampPendingChange();
			// Don't rewrite the field being typed in
			this.render(input);
		});
		return input;
	}

	private buildConditionIcons(
		container: HTMLElement,
		character: CreatureInstance,
		data: EncounterData,
		ctx: MarkdownPostProcessorContext
	): void {
		const conditions = character.conditions || [];
		const conditionManager = new ConditionManager();

		conditions.forEach((conditionEntry) => {
			let conditionKey: string;
			let conditionData: Condition | null = null;
			if (typeof conditionEntry === "string") {
				conditionKey = conditionEntry;
			} else if (typeof conditionEntry === "object" && conditionEntry.key) {
				conditionKey = conditionEntry.key;
				conditionData = conditionEntry;
			} else {
				return;
			}

			const condition = conditionManager.getAnyConditionByKey(conditionKey);
			if (!condition) return;
			const iconEl = container.createSpan({ cls: "ds-pool-condition" });
			setIcon(iconEl, condition.iconName);
			iconEl.title = `${condition.displayName} (click to remove)`;

			// Apply color and effect customizations
			if (conditionData?.color) iconEl.style.color = conditionData.color;
			if (conditionData?.effect) iconEl.classList.add(`condition-effect-${conditionData.effect}`);

			iconEl.addEventListener("click", () => {
				character.conditions = conditions.filter((entry) => entry !== conditionEntry);
				container.empty();
				this.buildConditionIcons(container, character, data, ctx);
				CodeBlocks.updateCodeBlock(this.app, data, ctx, "");
			});
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Changes
	// ---------------------------------------------------------------------------------------------

	private numberIn(input: HTMLInputElement): number {
		const value = parseInt(input.value);
		return isNaN(value) ? NaN : Math.max(0, value);
	}

	/** The pool change the amount would add: damage to the given number of minions, or healing. */
	private amountChange(kind: Preview): number {
		const amount = this.numberIn(this.els.amount);
		if (isNaN(amount)) return 0;
		if (kind === 'heal') return Math.min(amount, this.poolMaxStamina - this.committedStamina());
		const minions = this.numberIn(this.els.count);
		if (isNaN(minions)) return 0;
		// Overkill damage is capped, so it can always be applied (it kills every remaining minion)
		return -Math.min(amount * minions, this.committedStamina());
	}

	private applyAmount(kind: Preview) {
		this.pendingStaminaChange += this.amountChange(kind);
		this.clampPendingChange();
		// Still hovering: the next preview starts from here, after the button is left
		this.hoverPreview = null;
		this.render();
	}

	/** The preview in effect: the hovered button, else what Enter would do while typing in the amount fields. */
	private currentPreview(): Preview | null {
		if (this.hoverPreview) return this.hoverPreview;
		const active = activeDocument.activeElement;
		const typing = (active === this.els.amount || active === this.els.count) && this.numberIn(this.els.amount) > 0;
		if (!typing) return null;
		// Holding the healing shortcut's modifiers (Shift by default) previews healing, else damage
		const healing = currentHotkeyFor('applyHealing');
		if (healing && this.heldModifiers && modifiersOfHotkey(healing) === this.heldModifiers) return 'heal';
		return currentHotkeyFor('applyDamage') ? 'damage' : null;
	}

	// Keep the pool between 0 and its max
	private clampPendingChange() {
		this.pendingStaminaChange = this.clampPool(this.poolCurrentStamina + this.pendingStaminaChange) - this.poolCurrentStamina;
	}

	private clampPool(stamina: number): number {
		return Math.min(this.poolMaxStamina, Math.max(0, stamina));
	}

	private committedStamina(): number {
		return this.clampPool(this.poolCurrentStamina + this.pendingStaminaChange);
	}

	/** How many more minions are dead with the pool at `stamina` than now. */
	private minionsKilledAt(stamina: number): number {
		if (this.minionMaxStamina <= 0) return 0;
		const killedNow = Math.floor((this.poolMaxStamina - this.poolCurrentStamina) / this.minionMaxStamina);
		const killedThen = Math.floor((this.poolMaxStamina - stamina) / this.minionMaxStamina);
		return Math.max(0, killedThen - killedNow);
	}

	private togglePick(instance: CreatureInstance) {
		const toKill = this.minionsKilledAt(this.committedStamina());
		if (this.picked.has(instance)) {
			// At 0 every minion dies, so none can be unpicked
			if (this.committedStamina() > 0) this.picked.delete(instance);
		} else if (this.picked.size < toKill) {
			this.picked.add(instance);
		}
		this.render();
	}

	/** Keeps the picked minions in line with how many die: all of them at 0, never more than die. */
	private syncPicks() {
		const toKill = this.minionsKilledAt(this.committedStamina());
		if (this.committedStamina() <= 0) {
			this.aliveMinions.forEach((instance) => this.picked.add(instance));
			return;
		}
		[...this.picked].slice(toKill).forEach((instance) => this.picked.delete(instance));
	}

	private canSave(): boolean {
		return this.pendingStaminaChange !== 0 && this.picked.size === this.minionsKilledAt(this.committedStamina());
	}

	private save() {
		if (this.pendingStaminaChange === 0) {
			this.close();
			return;
		}
		if (!this.canSave()) return;
		this.group.minion_stamina_pool = this.committedStamina();
		this.picked.forEach((instance) => { instance.isDead = true; });
		this.updateCallback();
		this.close();
	}

	/** Where a pool value sits on the bar, in percent. */
	private position(stamina: number): number {
		if (this.poolMaxStamina <= 0) return 0;
		return Math.max(0, Math.min(100, stamina / this.poolMaxStamina * 100));
	}

	// ---------------------------------------------------------------------------------------------
	// Display
	// ---------------------------------------------------------------------------------------------

	/** Shows the pending changes everywhere, except in `editing` (the field being typed in). */
	private render(editing?: HTMLInputElement) {
		this.syncPicks();
		const els = this.els;
		// Committed: the pending change. Shown: that plus the preview, if any.
		const committed = this.committedStamina();
		const preview = this.currentPreview();
		const resulting = this.clampPool(committed + (preview ? this.amountChange(preview) : 0));
		const change = resulting - this.poolCurrentStamina;
		const kills = this.minionsKilledAt(resulting);
		const toKill = this.minionsKilledAt(committed);

		els.root.toggleClass('has-change', change !== 0);
		els.root.toggleClass('is-damage', change < 0);
		els.root.toggleClass('is-heal', change > 0);
		els.root.toggleClass('is-previewing', resulting !== committed);
		els.root.toggleClass('is-dead', resulting <= 0);

		// Numbers
		els.before.setText(`${this.poolCurrentStamina}`);
		els.after.setText(`${resulting}`);
		els.delta.setText(change > 0 ? `+${change}` : change < 0 ? `−${-change}` : '');
		els.killsTag.toggleClass('is-hidden', kills === 0);
		els.killsTag.setText(kills === this.aliveMinions.length ? 'All die' : `${kills} ${kills === 1 ? 'dies' : 'die'}`);
		const alive = this.aliveMinions.length;
		els.minionsLeft.setText(kills > 0
			? `${alive} → ${alive - kills} of ${alive} minions left · ${this.minionMaxStamina} Stamina each`
			: `${alive} ${alive === 1 ? 'minion' : 'minions'} left · ${this.minionMaxStamina} Stamina each`);

		// Bar: what's left, then what the pending change takes away or adds, then what the preview would
		const low = Math.min(this.poolCurrentStamina, committed, resulting);
		els.fill.style.width = `${this.position(low)}%`;
		this.setSegment(els.change, this.poolCurrentStamina, committed);
		this.setSegment(els.previewChange, committed, resulting);

		// Fields (the pending change, without the preview)
		if (editing !== els.poolInput) els.poolInput.value = `${committed}`;

		// Minions
		els.pickInfo.empty();
		if (toKill > 0 && committed > 0) {
			const done = this.picked.size === toKill;
			els.pickInfo.addClass('is-picking');
			els.pickInfo.toggleClass('is-done', done);
			els.pickInfo.setText(done ? `${toKill} picked` : `Pick ${toKill} to die · ${this.picked.size}/${toKill}`);
		} else {
			els.pickInfo.removeClasses(['is-picking', 'is-done']);
			if (toKill > 0) els.pickInfo.setText('All die');
		}
		els.minions.forEach(({ instance, el }) => {
			const isPicked = this.picked.has(instance);
			el.toggleClass('is-picked', isPicked);
			el.toggleClass('is-disabled', committed <= 0 || (!isPicked && this.picked.size >= toKill));
			el.setAttr('aria-checked', `${isPicked}`);
		});

		// What will change (without the preview)
		const pendingChange = committed - this.poolCurrentStamina;
		els.summary.empty();
		if (pendingChange < 0) els.summary.createSpan({ cls: 'is-damage', text: `−${-pendingChange} Stamina` });
		if (pendingChange > 0) {
			els.summary.createSpan({ cls: 'is-heal', text: `+${pendingChange} Stamina` });
			const warningEl = els.summary.createSpan({ cls: 'ds-pool-warning', attr: { title: 'Typically minions are unable to regain stamina' } });
			setIcon(warningEl, 'alert-triangle');
		}
		if (toKill > 0) els.summary.createSpan({ cls: 'is-damage', text: `${toKill} ${toKill === 1 ? 'minion dies' : 'minions die'}` });
		if (pendingChange === 0) els.summary.createSpan({ text: 'No changes' });

		els.reset.disabled = pendingChange === 0;
		els.apply.disabled = !this.canSave();
		els.apply.title = pendingChange !== 0 && !this.canSave() ? `Pick ${toKill} ${toKill === 1 ? 'minion' : 'minions'} to die first` : '';
	}

	/** Marks the part of the bar between two pool values as damage (going down) or healing (going up). */
	private setSegment(el: HTMLElement, from: number, to: number) {
		const left = this.position(Math.min(from, to));
		el.style.left = `${left}%`;
		el.style.width = `${this.position(Math.max(from, to)) - left}%`;
		el.toggleClass('is-damage', to < from);
		el.toggleClass('is-heal', to > from);
	}
}
