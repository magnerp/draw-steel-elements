import {App, parseYaml, TFile} from "obsidian";
import {Statblock} from "steel-compendium-sdk";
import type {Hero} from "@drawSteelAdmonition/EncounterData";
import {StatblockConfig} from "@model/StatblockConfig";
import {ReferenceResolver} from "@utils/ReferenceResolver";

/**
 * A `ds-hero` block: a hero's definition (characteristics, stats, abilities) plus their current state
 * (stamina, recoveries, heroic resource, surges, victories). Heroes in a party or an encounter that link
 * to it with `statblock: [[Note]]` read and write their stamina and recoveries here.
 */
export interface HeroSheet {
    type?: "hero";
    name: string;
    level?: number;
    class?: string;
    subclass?: string;
    ancestry?: string | string[];
    image?: string;
    size?: string;
    speed?: number; // Without kit bonuses, like stability and max_stamina
    stability?: number;
    movement?: string;
    immunities?: string[];
    weaknesses?: string[];
    might?: number;
    agility?: number;
    reason?: number;
    intuition?: number;
    presence?: number;
    max_stamina: number; // Becomes the total (with the kit's stamina bonus) once initialized
    max_recoveries?: number;
    recovery_value?: number; // Defaults to a third of max stamina
    heroic_resource?: string; // Name of the class's resource, e.g. "Essence"
    kit?: KitRef | KitRef[]; // A kit note ([[Mountain]]) or the kit's bonuses written out; a list for two kits
    kits?: KitRef[]; // Same as a `kit` list
    features?: any[];

    // State
    current_stamina?: number;
    temp_stamina?: number;
    current_recoveries?: number;
    resource?: number;
    surges?: number;
    victories?: number;

    // Runtime only (never written back)
    base_max_stamina?: number; // max_stamina as written, without the kit
    kits_details?: HeroKit[]; // Each kit, resolved from its note if it's a link
    kit_details?: HeroKit; // The bonuses that apply: the kit's, or the higher of each between two kits
}

type KitRef = string | HeroKit;

/**
 * A kit's bonuses. Damage bonuses are a number for all tiers, a "+1/+1/+2" string or a [t1, t2, t3] list,
 * as written in the kit. The stamina bonus is per echelon.
 */
export interface HeroKit {
    name?: string;
    stamina_bonus?: number;
    speed_bonus?: number;
    stability_bonus?: number;
    disengage_bonus?: number;
    melee_damage_bonus?: TierBonus;
    ranged_damage_bonus?: TierBonus;
    melee_distance_bonus?: number;
    ranged_distance_bonus?: number;
    signature_ability?: string; // Markdown, from a kit note
    path?: string; // The kit note
    error?: string; // Set if the kit note couldn't be read
}

type TierBonus = number | string | number[];

/** Fields of a hero sheet that change during play; the only ones the plugin writes back. */
export type HeroSheetState = Pick<HeroSheet,
    "current_stamina" | "temp_stamina" | "current_recoveries" | "resource" | "surges" | "victories">;

const STATE_KEYS: (keyof HeroSheetState)[] = [
    "current_stamina", "temp_stamina", "current_recoveries", "resource", "surges", "victories",
];

// Matches the first ```ds-hero ... ``` (or ~~~) block in a note
const HERO_BLOCK_REGEX = /^([`~]{3,})ds-hero[ \t]*\n([\s\S]*?)^\1[ \t]*$/m;

/** True if a resolved statblock reference (the first ds- block of a note) is a hero sheet. */
export function isHeroSheet(raw: any): boolean {
    return raw?.type === "hero" || raw?.max_recoveries != null || raw?.heroic_resource != null;
}

/** Echelon for a hero level: 1st (levels 1-3) to 4th (level 10). */
export function echelon(level: number | undefined): number {
    return Math.min(4, Math.floor(((level ?? 1) - 1) / 3) + 1);
}

/** An unquoted `[[Mountain]]` parses as a nested list; turn it back into the link. */
function normalizeKitRef(kit: any): any {
    let inner: any = kit;
    while (Array.isArray(inner) && inner.length === 1) inner = inner[0];
    if (!Array.isArray(kit) || typeof inner !== "string") return kit;
    return inner.startsWith("[[") ? inner : `[[${inner}]]`;
}

/**
 * The sheet's kits as a list: `kit` (or `kits`) is one kit, or a list of them for heroes with two (a
 * tactician's Field Arsenal), e.g. `kit: ["[[Shining Armor]]", "[[Sniper]]"]`.
 */
function kitRefs(rawKit: any): any[] {
    if (rawKit == null) return [];
    const single = normalizeKitRef(rawKit);
    // A single unquoted link, or a list holding just one kit
    if (!Array.isArray(single)) return [single];
    return single.map(normalizeKitRef).filter((kit) => kit != null);
}

const KIT_BONUS_FIELDS: Record<string, keyof HeroKit> = {
    "stamina": "stamina_bonus",
    "speed": "speed_bonus",
    "stability": "stability_bonus",
    "disengage": "disengage_bonus",
    "melee damage": "melee_damage_bonus",
    "ranged damage": "ranged_damage_bonus",
    "melee distance": "melee_distance_bonus",
    "ranged distance": "ranged_distance_bonus",
};

/**
 * Reads a kit note as written in the compendium: `**Melee Damage Bonus:** +0/+0/+4` lines under "Kit Bonuses"
 * and the markdown of its "Signature Ability" section.
 */
export function parseKitNote(content: string, name: string, path: string): HeroKit {
    const kit: HeroKit = {name, path};
    const bonusRegex = /\*\*\s*([A-Za-z ]+?) Bonus:?\s*\*\*:?\s*([^\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = bonusRegex.exec(content)) !== null) {
        const field = KIT_BONUS_FIELDS[match[1].trim().toLowerCase()];
        if (!field) continue;
        const value = match[2].trim();
        if (field === "melee_damage_bonus" || field === "ranged_damage_bonus") {
            (kit as any)[field] = value;
        } else {
            const number = parseInt(value, 10); // "+9 per echelon" -> 9
            if (!isNaN(number)) (kit as any)[field] = number;
        }
    }
    // The section runs until the next heading of the same or a higher level
    const lines = content.split("\n");
    const start = lines.findIndex((line) => /^#+\s*Signature Ability\s*$/i.test(line));
    if (start >= 0) {
        const level = lines[start].match(/^#+/)![0].length;
        let end = start + 1;
        const headingLevel = (line: string) => line.match(/^(#+)\s/)?.[1].length ?? Infinity;
        while (end < lines.length && headingLevel(lines[end]) > level) end++;
        kit.signature_ability = lines.slice(start + 1, end).join("\n").trim();
    }
    return kit;
}

/** Resolves the sheet's kits (links to kit notes, or the bonuses written out); empty if it has none. */
export async function resolveKits(app: App, resolver: ReferenceResolver, raw: any): Promise<HeroKit[]> {
    return Promise.all(kitRefs(raw?.kits ?? raw?.kit).map((kit) => resolveKit(app, resolver, kit)));
}

async function resolveKit(app: App, resolver: ReferenceResolver, kit: any): Promise<HeroKit> {
    if (typeof kit === "object") return kit as HeroKit;
    const ref = `${kit}`;
    const file = resolver.resolveFile(ref);
    if (!file) {
        return {name: ReferenceResolver.referencePath(ref), error: `Kit note '${ReferenceResolver.referencePath(ref)}' not found.`};
    }
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const name = frontmatter?.item_name ?? frontmatter?.name ?? file.basename;
    return parseKitNote(await app.vault.read(file), name, file.path);
}

/** Validates a parsed ds-hero block, resolves its kits and initializes it (see initHeroSheet). */
export async function loadHeroSheet(app: App, resolver: ReferenceResolver, raw: any): Promise<HeroSheet> {
    return initHeroSheet(raw, await resolveKits(app, resolver, raw));
}

const tierTotal = (bonus: TierBonus | undefined) => tierBonuses(bonus).reduce((a, b) => a + b, 0);

/**
 * The bonuses that apply with these kits. With two kits the bonuses don't stack: for each benefit the hero
 * takes one kit's or the other's, normally the higher (Draw Steel, Tactician: Field Arsenal).
 */
export function combineKits(kits: HeroKit[]): HeroKit | undefined {
    const usable = kits.filter((kit) => !kit.error);
    if (usable.length <= 1) return usable[0];
    const higher = (field: "stamina_bonus" | "speed_bonus" | "stability_bonus" | "disengage_bonus"
        | "melee_distance_bonus" | "ranged_distance_bonus") => Math.max(...usable.map((kit) => kit[field] ?? 0));
    const best = (field: "melee_damage_bonus" | "ranged_damage_bonus") =>
        usable.reduce<TierBonus | undefined>((a, kit) => (tierTotal(kit[field]) > tierTotal(a) ? kit[field] : a), undefined);
    return {
        name: usable.map((kit) => kit.name ?? "Kit").join(" & "),
        stamina_bonus: higher("stamina_bonus"),
        speed_bonus: higher("speed_bonus"),
        stability_bonus: higher("stability_bonus"),
        disengage_bonus: higher("disengage_bonus"),
        melee_damage_bonus: best("melee_damage_bonus"),
        ranged_damage_bonus: best("ranged_damage_bonus"),
        melee_distance_bonus: higher("melee_distance_bonus"),
        ranged_distance_bonus: higher("ranged_distance_bonus"),
    };
}

/**
 * Validates a parsed ds-hero block, adds the kits' stamina bonus to max stamina and fills in the state
 * defaults. `kits` are the resolved kits (see resolveKits).
 */
export function initHeroSheet(raw: any, kits: HeroKit[] = []): HeroSheet {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("The input must be a YAML object.");
    }
    const sheet = raw as HeroSheet;
    if (!sheet.name) {
        throw new Error("The hero is missing the 'name' field.");
    }
    // Accept `stamina` like a statblock
    if (sheet.max_stamina == null && (raw as any).stamina != null) {
        sheet.max_stamina = +(raw as any).stamina;
    }
    if (typeof sheet.max_stamina !== "number" || isNaN(sheet.max_stamina)) {
        throw new Error(`Hero '${sheet.name}' is missing or has an invalid 'max_stamina' field.`);
    }
    for (const key of ["max_recoveries", "recovery_value", ...STATE_KEYS] as const) {
        if (sheet[key] != null && typeof sheet[key] !== "number") {
            throw new Error(`Hero '${sheet.name}' has an invalid '${key}' field (must be a number).`);
        }
    }
    sheet.kits_details = kits;
    const kit = combineKits(kits);
    sheet.kit_details = kit;
    sheet.base_max_stamina = sheet.max_stamina;
    sheet.max_stamina += (kit?.stamina_bonus ?? 0) * echelon(sheet.level);
    sheet.current_stamina = sheet.current_stamina ?? sheet.max_stamina;
    sheet.temp_stamina = sheet.temp_stamina ?? 0;
    if (sheet.max_recoveries != null) {
        sheet.current_recoveries = sheet.current_recoveries ?? sheet.max_recoveries;
    }
    sheet.resource = sheet.resource ?? 0;
    sheet.surges = sheet.surges ?? 0;
    sheet.victories = sheet.victories ?? 0;
    return sheet;
}

/** The sheet as a Hero (sharing stamina/recoveries fields), for the stamina modal and recovery control. */
export function sheetAsHero(sheet: HeroSheet): Hero {
    return sheet as unknown as Hero;
}

/** "13/18", or "13 (+5)/18" with temporary stamina: current over max, kit included. */
function staminaText(sheet: HeroSheet): string {
    const current = sheet.current_stamina ?? sheet.max_stamina;
    const temp = sheet.temp_stamina ?? 0;
    return `${current}${temp > 0 ? ` (+${temp})` : ""}/${sheet.max_stamina}`;
}

/** The sheet's stats and abilities as a statblock, to render them like a ds-statblock. */
export function sheetAsStatblock(sheet: HeroSheet): StatblockConfig {
    const ancestry = Array.isArray(sheet.ancestry) ? sheet.ancestry : sheet.ancestry ? [sheet.ancestry] : [];
    const role = [sheet.class, sheet.subclass ? `(${sheet.subclass})` : undefined].filter(Boolean).join(" ");
    const dto: any = {
        type: "statblock",
        name: sheet.name,
        level: sheet.level,
        roles: role ? [role] : [],
        ancestry,
        ev: "-",
        stamina: staminaText(sheet),
        speed: sheet.speed != null ? sheet.speed + (sheet.kit_details?.speed_bonus ?? 0) : undefined,
        movement: sheet.movement,
        size: sheet.size,
        stability: sheet.stability != null ? sheet.stability + (sheet.kit_details?.stability_bonus ?? 0) : undefined,
        immunities: sheet.immunities,
        weaknesses: sheet.weaknesses,
        might: sheet.might,
        agility: sheet.agility,
        reason: sheet.reason,
        intuition: sheet.intuition,
        presence: sheet.presence,
        features: sheet.features ?? [],
    };
    return new StatblockConfig(Statblock.modelDTOAdapter(dto));
}

function tierBonuses(bonus: TierBonus | undefined): number[] {
    if (bonus == null) return [0, 0, 0];
    if (typeof bonus === "number") return [bonus, bonus, bonus];
    const parts = Array.isArray(bonus) ? bonus.map(Number) : `${bonus}`.split("/").map((part) => parseInt(part.trim(), 10));
    const values = parts.map((value) => (isNaN(value) ? 0 : value));
    // A single value applies to every tier
    return values.length === 1 ? [values[0], values[0], values[0]] : [0, 1, 2].map((i) => values[i] ?? 0);
}

/**
 * The two standard free strikes every hero has (Draw Steel, Chapter 10: Combat), as feature DTOs: power roll
 * + Might or Agility (whichever is higher), improved by the kit's damage and distance bonuses.
 */
export function standardFreeStrikes(sheet: HeroSheet): any[] {
    const might = sheet.might ?? 0;
    const agility = sheet.agility ?? 0;
    const useMight = might >= agility;
    const characteristic = useMight ? might : agility;
    const label = useMight ? "Might" : "Agility";
    const kit = sheet.kit_details ?? {};
    const kitNote = !kit.name ? ""
        : (sheet.kits_details?.length ?? 0) > 1 ? ` Includes the higher bonuses of the ${kit.name} kits.`
        : ` Includes the ${kit.name} kit's bonuses.`;

    const strike = (name: string, icon: string, keywords: string[], distance: string, base: number[], bonus: TierBonus | undefined) => {
        const kitBonus = tierBonuses(bonus);
        const damage = base.map((value, tier) => `${value + characteristic + kitBonus[tier]} damage`);
        return {
            type: "feature",
            feature_type: "ability",
            name,
            icon,
            ability_type: "Free Strike",
            keywords,
            usage: "Main action",
            distance,
            target: "One creature or object",
            effects: [
                {roll: `Power Roll + ${characteristic}`, tier1: damage[0], tier2: damage[1], tier3: damage[2]},
                {
                    name: "Effect",
                    effect: `Uses ${label} (the higher of Might and Agility).${kitNote}`,
                },
            ],
        };
    };
    return [
        strike("Melee Weapon Free Strike", "🗡", ["Charge", "Melee", "Strike", "Weapon"],
            `Melee ${1 + (kit.melee_distance_bonus ?? 0)}`, [2, 5, 7], kit.melee_damage_bonus),
        strike("Ranged Weapon Free Strike", "🏹", ["Ranged", "Strike", "Weapon"],
            `Ranged ${5 + (kit.ranged_distance_bonus ?? 0)}`, [2, 4, 6], kit.ranged_damage_bonus),
    ];
}

export class HeroSheetStore {
    /** Reads the first ds-hero block of a note, as written (not initialized). */
    static async load(app: App, path: string): Promise<any> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            throw new Error(`Hero note '${path}' not found.`);
        }
        const match = (await app.vault.read(file)).match(HERO_BLOCK_REGEX);
        if (!match) {
            throw new Error(`No ds-hero code block found in ${path}`);
        }
        return parseYaml(match[2]) ?? {};
    }

    /** Copies the sheet's current stamina and recoveries onto a hero linked to it. */
    static async reloadHero(app: App, hero: Hero): Promise<void> {
        if (!hero.sheet_path) return;
        const raw = await HeroSheetStore.load(app, hero.sheet_path);
        hero.current_stamina = raw.current_stamina ?? hero.max_stamina;
        hero.temp_stamina = raw.temp_stamina ?? 0;
        if (hero.max_recoveries != null) {
            hero.current_recoveries = raw.current_recoveries ?? hero.max_recoveries;
        }
    }

    /** Saves a linked hero's stamina and recoveries to their sheet. */
    static async saveHero(app: App, hero: Hero): Promise<void> {
        if (!hero.sheet_path) return;
        const state: HeroSheetState = {current_stamina: hero.current_stamina, temp_stamina: hero.temp_stamina};
        if (hero.max_recoveries != null) {
            state.current_recoveries = hero.current_recoveries;
        }
        await HeroSheetStore.saveState(app, hero.sheet_path, state);
    }

    /**
     * Writes state fields into the note's ds-hero block, one top-level `key: value` line each, so the rest
     * of the block (abilities, comments, formatting) stays as written. Keys left out of `state` are untouched.
     */
    static async saveState(app: App, path: string, state: HeroSheetState): Promise<void> {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            console.warn(`Draw Steel Elements: hero note '${path}' not found. Change NOT saved.`);
            return;
        }
        await app.vault.process(file, (content) => {
            const match = content.match(HERO_BLOCK_REGEX);
            if (!match || match.index == null) {
                console.warn(`Draw Steel Elements: no ds-hero block found in ${path}. Change NOT saved.`);
                return content;
            }
            const lines = match[2].replace(/\n$/, "").split("\n");
            (Object.keys(state) as (keyof HeroSheetState)[]).forEach((key) => {
                if (!STATE_KEYS.includes(key)) return;
                const value = state[key];
                const index = lines.findIndex((line) => line.startsWith(`${key}:`));
                if (value == null) {
                    if (index >= 0) lines.splice(index, 1);
                } else if (index >= 0) {
                    lines[index] = `${key}: ${value}`;
                } else {
                    // New state lines go before the (long) features list
                    const featuresIndex = lines.findIndex((line) => line.startsWith("features:"));
                    lines.splice(featuresIndex >= 0 ? featuresIndex : lines.length, 0, `${key}: ${value}`);
                }
            });
            const fence = match[1];
            const block = `${fence}ds-hero\n${lines.join("\n")}\n${fence}`;
            return content.substring(0, match.index) + block + content.substring(match.index + match[0].length);
        });
    }
}
