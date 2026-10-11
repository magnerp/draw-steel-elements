import {ConditionStyle} from "@utils/Conditions";

export interface DSESettings {
	compendiumReleaseTag?: string; // Optional: if not set, fetch the latest release
	compendiumDestinationDirectory: string;
	defaultImagePath: string;
	conditionStyles?: Record<string, ConditionStyle>; // Last color/effect picked per condition key
}

export const DEFAULT_SETTINGS: DSESettings = {
	compendiumReleaseTag: '', // Leave empty to fetch the latest release
	compendiumDestinationDirectory: 'DS Compendium', // Default directory in the vault
	defaultImagePath: 'Media/token_1.png',
};
