import { App, Modal, setIcon } from 'obsidian';
import { Condition } from "@drawSteelAdmonition/EncounterData";
import { ConditionManager, ConditionConfig } from "@utils/Conditions";
import { CustomizeConditionModal } from "@views/CustomizeConditionModal";

type ConditionEntry = string | Condition;

function entryKey(entry: ConditionEntry): string {
	return typeof entry === 'string' ? entry : entry.key;
}

/**
 * The conditions of one hero or creature. Each condition is either on or off, so a creature never has the same
 * condition twice: picking a condition it already has takes it off. Nothing changes until Apply.
 *
 * Keyboard: type to filter, arrow keys to move between conditions, Space to toggle, Enter in the search field to
 * toggle the first match (or apply when it's empty), Ctrl+Enter to apply from anywhere, Escape to cancel.
 * Shift+Enter on a condition customizes its icon.
 */
export class ConditionsModal extends Modal {
	// The conditions it had when the window opened, by key
	private initial = new Map<string, ConditionEntry>();
	// The conditions it will have, by key
	private chosen = new Map<string, ConditionEntry>();
	private items: { config: ConditionConfig; el: HTMLElement; iconEl: HTMLElement }[] = [];
	private searchEl: HTMLInputElement;
	private summaryEl: HTMLElement;

	constructor(
		app: App,
		private name: string,
		current: ConditionEntry[],
		private conditionManager: ConditionManager,
		private onApply: (conditions: ConditionEntry[]) => void,
	) {
		super(app);
		// The first entry of a condition wins: older notes may list one twice
		current.forEach((entry) => {
			const key = entryKey(entry);
			if (key && !this.initial.has(key)) this.initial.set(key, entry);
		});
		this.chosen = new Map(this.initial);
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('ds-cond-modal-container');
		const container = contentEl.createEl('div', { cls: 'ds-cond-modal' });

		const headerEl = container.createEl('div', { cls: 'ds-cond-header' });
		headerEl.createEl('h2', { text: 'Conditions' });
		headerEl.createEl('div', { cls: 'ds-cond-subtitle', text: this.name });

		this.searchEl = container.createEl('input', {
			cls: 'ds-cond-search',
			attr: { type: 'text', placeholder: 'Type to filter, Enter to toggle the first match', spellcheck: 'false' },
		});
		this.searchEl.addEventListener('input', () => this.filter());
		this.searchEl.addEventListener('keydown', (e) => this.onSearchKey(e));

		this.buildGroup(container, this.conditionManager.getConditions());
		const pseudo = this.conditionManager.getPseudoConditions();
		if (pseudo.length > 0) {
			this.buildGroup(container, pseudo, 'Other');
		}

		const footerEl = container.createEl('div', { cls: 'ds-cond-footer' });
		const hintsEl = footerEl.createEl('div', { cls: 'ds-cond-hints' });
		[['↑↓←→', 'move'], ['Space', 'toggle'], ['Ctrl+Enter', 'apply'], ['Esc', 'cancel']].forEach(([key, what]) => {
			const hintEl = hintsEl.createSpan();
			hintEl.createEl('kbd', { text: key });
			hintEl.appendText(` ${what}`);
		});
		this.summaryEl = footerEl.createEl('div', { cls: 'ds-cond-summary' });
		const buttonsEl = footerEl.createEl('div', { cls: 'ds-cond-buttons' });
		buttonsEl.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		buttonsEl.createEl('button', { text: 'Apply', cls: 'mod-cta' }).addEventListener('click', () => this.apply());

		// Ctrl+Enter applies from anywhere in the window
		container.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.apply();
			}
		});

		this.refreshStates();
		this.searchEl.focus();
	}

	private buildGroup(container: HTMLElement, conditions: ConditionConfig[], label?: string) {
		const groupEl = container.createEl('div', { cls: 'ds-cond-group' });
		if (label) groupEl.createEl('div', { cls: 'ds-cond-group-label', text: label });
		const gridEl = groupEl.createEl('div', { cls: 'ds-cond-grid' });
		conditions.forEach((config) => {
			const el = gridEl.createEl('button', { cls: 'ds-cond-item' });
			const iconEl = el.createSpan({ cls: 'ds-cond-icon' });
			el.createSpan({ cls: 'ds-cond-label', text: config.displayName });
			el.createSpan({ cls: 'ds-cond-state' });
			const customizeEl = el.createSpan({ cls: 'ds-cond-customize', attr: { 'aria-label': 'Customize icon (Shift+Enter)' } });
			setIcon(customizeEl, 'palette');

			const item = { config, el, iconEl };
			this.items.push(item);
			this.updateIcon(item);

			el.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).closest('.ds-cond-customize')) {
					e.stopPropagation();
					this.customize(item);
					return;
				}
				this.toggle(config.key);
			});
			el.addEventListener('keydown', (e) => this.onItemKey(e, item));
		});
	}

	// ---------------------------------------------------------------------------------------------
	// State
	// ---------------------------------------------------------------------------------------------

	private toggle(key: string) {
		if (this.chosen.has(key)) {
			this.chosen.delete(key);
		} else {
			this.chosen.set(key, this.initial.get(key) ?? this.styledCondition(key));
		}
		this.refreshStates();
	}

	/** Marks each condition kept, added, removed or off, and sums up the changes. */
	private refreshStates() {
		let added = 0;
		let removed = 0;
		this.items.forEach(({ config, el }) => {
			const was = this.initial.has(config.key);
			const is = this.chosen.has(config.key);
			el.toggleClass('is-on', is);
			el.toggleClass('is-adding', is && !was);
			el.toggleClass('is-removing', was && !is);
			el.setAttr('aria-pressed', `${is}`);
			const stateEl = el.querySelector<HTMLElement>('.ds-cond-state');
			stateEl?.setText(is && !was ? 'Add' : was && !is ? 'Remove' : is ? 'On' : '');
			if (is && !was) added++;
			if (was && !is) removed++;
		});
		this.summaryEl.empty();
		if (added) this.summaryEl.createSpan({ cls: 'is-adding', text: `+${added}` });
		if (removed) this.summaryEl.createSpan({ cls: 'is-removing', text: `−${removed}` });
		if (!added && !removed) this.summaryEl.createSpan({ text: 'No changes' });
	}

	private apply() {
		// Kept conditions stay in their order, added ones go last
		const kept = [...this.initial.keys()].filter((key) => this.chosen.has(key)).map((key) => this.chosen.get(key)!);
		const added = [...this.chosen.entries()].filter(([key]) => !this.initial.has(key)).map(([, entry]) => entry);
		this.onApply([...kept, ...added]);
		this.close();
	}

	// ---------------------------------------------------------------------------------------------
	// Keyboard
	// ---------------------------------------------------------------------------------------------

	private visibleItems() {
		return this.items.filter(({ el }) => !el.hasClass('is-hidden'));
	}

	private filter() {
		const query = this.searchEl.value.trim().toLowerCase();
		this.items.forEach(({ config, el }) => {
			el.toggleClass('is-hidden', query !== '' && !config.displayName.toLowerCase().includes(query));
			el.removeClass('is-first-match');
		});
		if (query) this.visibleItems()[0]?.el.addClass('is-first-match');
		// A group with no matches is hidden, label and all
		this.contentEl.querySelectorAll<HTMLElement>('.ds-cond-group').forEach((groupEl) => {
			groupEl.toggleClass('is-hidden', !groupEl.querySelector('.ds-cond-item:not(.is-hidden)'));
		});
	}

	private onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			const first = this.visibleItems()[0];
			if (this.searchEl.value.trim() === '') {
				this.apply();
			} else if (first) {
				this.toggle(first.config.key);
				this.searchEl.value = '';
				this.filter();
			}
		} else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && this.searchEl.selectionStart === this.searchEl.value.length)) {
			e.preventDefault();
			this.visibleItems()[0]?.el.focus();
		}
	}

	private onItemKey(e: KeyboardEvent, item: { config: ConditionConfig; el: HTMLElement; iconEl: HTMLElement }) {
		const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (arrows[e.key]) {
			e.preventDefault();
			const target = this.neighbor(item.el, ...arrows[e.key]);
			if (target) target.focus();
			else if (e.key === 'ArrowUp') this.searchEl.focus();
		} else if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			this.customize(item);
		} else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
			// Enter toggles like Space (the button's default would also click)
			e.preventDefault();
			this.toggle(item.config.key);
		} else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// Typing goes to the filter
			e.preventDefault();
			this.searchEl.value += e.key;
			this.searchEl.focus();
			this.filter();
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			this.searchEl.focus();
		}
	}

	/** The visible condition next to `from` in a direction, by on-screen position (the grid wraps). */
	private neighbor(from: HTMLElement, dx: number, dy: number): HTMLElement | null {
		const visible = this.visibleItems().map(({ el }) => el);
		if (dx !== 0) {
			return visible[visible.indexOf(from) + dx] ?? null;
		}
		const origin = from.getBoundingClientRect();
		const originX = origin.left + origin.width / 2;
		let best = null as HTMLElement | null;
		let bestScore = Infinity;
		visible.forEach((el) => {
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

	// ---------------------------------------------------------------------------------------------
	// Icons and customizing
	// ---------------------------------------------------------------------------------------------

	// A new condition entry with the color/effect last picked for this condition
	private styledCondition(key: string): Condition {
		const style = this.conditionManager.getStyle(key);
		const conditionData: Condition = { key };
		if (style?.color) conditionData.color = style.color;
		if (style?.effect) conditionData.effect = style.effect;
		return conditionData;
	}

	/** The icon with the color/effect it has (or would get) on this creature. */
	private updateIcon(item: { config: ConditionConfig; iconEl: HTMLElement }) {
		const entry = this.chosen.get(item.config.key) ?? this.styledCondition(item.config.key);
		const data: Condition = typeof entry === 'string' ? { key: entry } : entry;
		const { iconEl } = item;
		iconEl.className = 'ds-cond-icon';
		iconEl.empty();
		setIcon(iconEl, item.config.iconName);
		iconEl.style.color = data.color ?? '';
		if (data.effect && data.effect !== 'static') iconEl.addClass(`condition-effect-${data.effect}`);
	}

	/** Customizing a condition's color/effect also turns it on. */
	private customize(item: { config: ConditionConfig; el: HTMLElement; iconEl: HTMLElement }) {
		const key = item.config.key;
		const entry = this.chosen.get(key) ?? this.styledCondition(key);
		const data: Condition = typeof entry === 'string' ? { key: entry } : entry;
		new CustomizeConditionModal(this.app, data, item.config, (updated) => {
			this.chosen.set(key, updated);
			this.updateIcon(item);
			this.refreshStates();
			void this.conditionManager.setStyle(key, updated);
			item.el.focus();
		}).open();
	}
}
