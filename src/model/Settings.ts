import {ConditionStyle} from "@utils/Conditions";

export interface DSESettings {
	compendiumReleaseTag?: string; // Optional: if not set, fetch the latest release
	compendiumDestinationDirectory: string;
	defaultImagePath: string;
	conditionStyles?: Record<string, ConditionStyle>; // Last color/effect picked per condition key
	initiativeLayout?: InitiativeLayout; // Last sizes the initiative tracker was dragged to
	hotkeys?: Partial<Record<InitiativeHotkeyAction, string>>; // Initiative tracker shortcuts ("" turns one off)
}

export type InitiativeHotkeyAction = "editStamina" | "kill" | "selectNext" | "selectPrevious"
	| "nextGroup" | "previousGroup" | "resetRound" | "editConditions" | "clearConditions"
	| "applyDamage" | "applyHealing";

export const DEFAULT_HOTKEYS: Record<InitiativeHotkeyAction, string> = {
	editStamina: "D",
	kill: "K",
	selectNext: "ArrowDown",
	selectPrevious: "ArrowUp",
	nextGroup: "ArrowRight",
	previousGroup: "ArrowLeft",
	resetRound: "R",
	editConditions: "C",
	clearConditions: "Shift+C",
	applyDamage: "Enter",
	applyHealing: "Shift+Enter",
};

export interface InitiativeLayout {
	trackerRatio?: number; // Share of the width taken by the tracker (the creature view gets the rest)
	height?: number; // Height in px of the tracker and creature view
}

export const DEFAULT_SETTINGS: DSESettings = {
	compendiumReleaseTag: '', // Leave empty to fetch the latest release
	compendiumDestinationDirectory: 'DS Compendium', // Default directory in the vault
	defaultImagePath: 'Media/token_1.png',
};
