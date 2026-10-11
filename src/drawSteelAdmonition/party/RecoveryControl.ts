import {setIcon} from "obsidian";
import {Hero} from "@drawSteelAdmonition/EncounterData";
import {Stamina} from "@utils/Stamina";

/**
 * Renders a "Recoveries x/y" counter with -/+ buttons for a hero that has `max_recoveries`.
 * The buttons only change the count; spending a Recovery to regain stamina is done in the stamina modal.
 */
export function buildRecoveryControl(container: HTMLElement, hero: Hero, onChange: () => void): void {
    if (hero.max_recoveries == null) {
        return;
    }
    const max = hero.max_recoveries;
    const recoveryValue = Stamina.recoveryValue(hero.max_stamina, hero.recovery_value);

    const controlEl = container.createEl("div", {cls: "hero-recoveries"});
    controlEl.title = `Recovery value: ${recoveryValue} stamina. Spend a Recovery from the stamina window to regain stamina.`;

    const minusEl = controlEl.createEl("div", {cls: "recovery-adjust-btn"});
    setIcon(minusEl, "minus");
    minusEl.title = "Remove a Recovery";
    const textEl = controlEl.createEl("span", {cls: "recovery-text"});
    const plusEl = controlEl.createEl("div", {cls: "recovery-adjust-btn"});
    setIcon(plusEl, "plus");
    plusEl.title = "Add a Recovery";

    const render = () => {
        const current = hero.current_recoveries ?? max;
        textEl.setText(`Recoveries ${current}/${max}`);
        controlEl.toggleClass("no-recoveries", current <= 0);
    };
    render();

    minusEl.addEventListener("click", () => {
        const current = hero.current_recoveries ?? max;
        if (current <= 0) return;
        hero.current_recoveries = current - 1;
        render();
        onChange();
    });
    plusEl.addEventListener("click", () => {
        const current = hero.current_recoveries ?? max;
        if (current >= max) return;
        hero.current_recoveries = current + 1;
        render();
        onChange();
    });
}
