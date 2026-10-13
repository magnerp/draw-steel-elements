import {setIcon} from "obsidian";
import {Creature, CreatureInstance, EnemyGroup, Hero} from "@drawSteelAdmonition/EncounterData";
import {Stamina, StaminaStatus} from "@utils/Stamina";

/** A hero's or creature's stamina as the tracker shows it. */
export interface StaminaState {
    current: number;
    temp: number;
    max: number;
    status: StaminaStatus;
    // Filled part of the bar, 0 to 1
    ratio: number;
    // The squad's shared pool (minions in a squad) rather than the creature's own stamina
    pool: boolean;
    // Plain text, as in the statblock's Stamina stat ("34 (+5)/45", "Dead")
    text: string;
    title: string;
}

function isHero(character: Hero | CreatureInstance): character is Hero {
    return "isHero" in character ? character.isHero : false;
}

function clamp(ratio: number): number {
    return Math.min(1, Math.max(0, ratio));
}

export function staminaState(character: Hero | CreatureInstance, creature?: Creature, group?: EnemyGroup): StaminaState {
    if (group?.is_squad && creature?.squad_role === "minion") {
        const max = creature.max_stamina * creature.amount;
        if ((character as CreatureInstance).isDead) {
            return {current: 0, temp: 0, max, status: "dead", ratio: 0, pool: true, text: "Dead", title: "Dead"};
        }
        const current = group.minion_stamina_pool ?? 0;
        return {
            current, temp: 0, max, status: "healthy", ratio: max > 0 ? clamp(current / max) : 0, pool: true,
            text: `${current}/${max}`,
            title: `Squad Stamina pool (${creature.max_stamina} per minion)`,
        };
    }

    const current = character.current_stamina ?? 0;
    const temp = character.temp_stamina ?? 0;
    const hero = isHero(character);
    const max = hero ? character.max_stamina : creature?.max_stamina ?? 0;
    const ratio = max > 0 ? clamp(current / max) : 0;

    // Creatures other than heroes die at 0 stamina
    if (!hero && current <= 0 && temp <= 0) {
        return {current, temp, max, status: "dead", ratio: 0, pool: false, text: "Dead", title: "Dead"};
    }

    let status: StaminaStatus;
    let title = "";
    if (hero) {
        status = Stamina.status(current, max, true);
        if (status === "dying") title = `Dying (dead at ${Stamina.minimumStamina(max, true)})`;
        if (status === "dead") title = "Dead";
    } else {
        status = "healthy";
    }
    // Winded: at or below half of max stamina (heroes and enemies, but not minions)
    if (status === "healthy" && creature?.squad_role !== "minion" && Stamina.isWinded(current, max)) {
        status = "winded";
        title = `Winded (half of ${max} stamina is ${Stamina.windedThreshold(max)})`;
    }

    let text = `${current}`;
    if (temp > 0) text += ` (+${temp})`;
    text += `/${max}`;
    return {current, temp, max, status, ratio, pool: false, text, title};
}

/**
 * A living minion's share of its squad's Stamina pool, so its token shows damage like any creature's: the pool fills
 * the living minions in order, so the last one carries the damage that hasn't killed a minion yet.
 */
export function minionShareState(instance: CreatureInstance, creature: Creature, group: EnemyGroup): StaminaState {
    const max = creature.max_stamina;
    const alive = (creature.instances ?? []).filter((inst) => !inst.isDead);
    const pool = group.minion_stamina_pool ?? alive.length * max;
    const share = Math.min(max, Math.max(0, pool - alive.indexOf(instance) * max));
    return {
        current: share, temp: 0, max, status: "healthy", ratio: max > 0 ? clamp(share / max) : 0, pool: true,
        text: `${share}/${max}`,
        title: share < max ? `${share}/${max}: dies next as the Squad pool drops` : `${share}/${max}`,
    };
}

/** Puts the stamina as plain text in `el`, colored by its status. */
export function setStaminaText(el: HTMLElement, state: StaminaState): void {
    el.setText(state.text);
    el.title = state.title;
    setStatusClass(el, state);
}

function setStatusClass(el: HTMLElement, state: StaminaState): void {
    (["healthy", "winded", "dying", "dead"] as StaminaStatus[]).forEach((status) => {
        el.toggleClass(`is-${status}`, state.status === status);
    });
    el.toggleClass("has-temp", state.temp > 0);
}

const STATUS_LABELS: Partial<Record<StaminaStatus, string>> = {winded: "Winded", dying: "Dying", dead: "Dead"};

/** Stamina numbers, status tag and bar. `large` is the creature view's version. */
export function buildStaminaMeter(container: HTMLElement, state: StaminaState, large = false): HTMLElement {
    const meterEl = container.createEl("div", {cls: "ds-it-stamina"});
    if (large) meterEl.addClass("is-large");
    setStatusClass(meterEl, state);
    meterEl.title = state.title;

    const valuesEl = meterEl.createEl("div", {cls: "ds-it-stamina-values"});
    if (state.status === "dead" && state.text === "Dead") {
        const deadEl = valuesEl.createEl("span", {cls: "ds-it-stamina-dead"});
        setIcon(deadEl.createSpan(), "skull");
        deadEl.createSpan({text: "Dead"});
    } else {
        valuesEl.createEl("span", {cls: "ds-it-stamina-current", text: `${state.current}`});
        if (state.temp > 0) {
            valuesEl.createEl("span", {cls: "ds-it-stamina-temp", text: `+${state.temp}`, attr: {title: "Temporary Stamina"}});
        }
        valuesEl.createEl("span", {cls: "ds-it-stamina-max", text: `/${state.max}`});
        const label = STATUS_LABELS[state.status];
        if (label) valuesEl.createEl("span", {cls: "ds-it-status-tag", text: label});
    }

    const barEl = meterEl.createEl("div", {cls: "ds-it-meter"});
    barEl.createEl("div", {cls: "ds-it-meter-fill"}).style.width = `${state.ratio * 100}%`;
    if (state.temp > 0 && state.max > 0) {
        const tempEl = barEl.createEl("div", {cls: "ds-it-meter-temp"});
        tempEl.style.left = `${state.ratio * 100}%`;
        tempEl.style.width = `${Math.min(1 - state.ratio, state.temp / state.max) * 100}%`;
    }
    // Where winded starts (not for minions, which are never winded)
    if (!state.pool && state.max > 0) {
        barEl.createEl("div", {cls: "ds-it-meter-mark"}).style.left = `${Stamina.windedThreshold(state.max) / state.max * 100}%`;
    }
    return meterEl;
}
