import {DEFAULT_HOTKEYS, DSESettings, InitiativeHotkeyAction} from "@model/Settings";

/** Where a shortcut works: on the clicked initiative tracker, or in the stamina window's Apply field. */
export type HotkeyScope = "tracker" | "stamina";

export const HOTKEY_ACTIONS: { action: InitiativeHotkeyAction; scope: HotkeyScope; name: string; desc: string }[] = [
    {action: "editStamina", scope: "tracker", name: "Damage / heal", desc: "Open the stamina window of the selected hero or creature."},
    {action: "kill", scope: "tracker", name: "Kill", desc: "Kill the selected creature (not heroes)."},
    {action: "selectNext", scope: "tracker", name: "Select next", desc: "Select the next hero, or the next creature in the selected creature's group."},
    {action: "selectPrevious", scope: "tracker", name: "Select previous", desc: "Select the previous hero, or the previous creature in the selected creature's group."},
    {action: "nextGroup", scope: "tracker", name: "Next group", desc: "Select the next group: the heroes first, then each enemy group (its selected creature)."},
    {action: "previousGroup", scope: "tracker", name: "Previous group", desc: "Select the previous group: the heroes first, then each enemy group (its selected creature)."},
    {action: "resetRound", scope: "tracker", name: "Reset round", desc: "Mark every hero and enemy group as not having taken their turn."},
    {action: "editConditions", scope: "tracker", name: "Conditions", desc: "Open the conditions window of the selected hero or creature: pick a condition to add it, or one it has to remove it."},
    {action: "clearConditions", scope: "tracker", name: "Clear conditions", desc: "Remove every condition from the selected hero or creature."},
    {action: "applyDamage", scope: "stamina", name: "Apply as damage", desc: "In the stamina window's Apply field: deal the number as damage and save."},
    {action: "applyHealing", scope: "stamina", name: "Apply as healing", desc: "In the stamina window's Apply field: heal the number and save."},
];

// The plugin's settings, for windows opened from many places (e.g. the stamina window)
let settingsSource: (() => DSESettings) | null = null;

export function setHotkeySettings(source: () => DSESettings): void {
    settingsSource = source;
}

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

/**
 * A key press as a hotkey string such as "Ctrl+Shift+D", or null for a lone modifier key.
 * Letters are upper-cased so a binding doesn't depend on Caps Lock.
 */
export function hotkeyFromEvent(e: KeyboardEvent): string | null {
    if (MODIFIER_KEYS.includes(e.key)) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    const key = e.key === " " ? "Space" : e.key;
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    return parts.join("+");
}

/** The hotkey bound to an action ("" when turned off); the default before the settings are loaded. */
export function hotkeyFor(settings: DSESettings | null, action: InitiativeHotkeyAction): string {
    return settings?.hotkeys?.[action] ?? DEFAULT_HOTKEYS[action];
}

/** The action of `scope` bound to a key press, if any. */
export function actionForEvent(e: KeyboardEvent, scope: HotkeyScope): InitiativeHotkeyAction | null {
    const pressed = hotkeyFromEvent(e);
    if (!pressed) return null;
    const settings = settingsSource?.() ?? null;
    return HOTKEY_ACTIONS.find((entry) => entry.scope === scope && hotkeyFor(settings, entry.action) === pressed)
        ?.action ?? null;
}
