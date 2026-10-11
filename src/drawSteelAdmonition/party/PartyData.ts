import {App, parseYaml, stringifyYaml, TFile} from "obsidian";
import {DSESettings} from "@model/Settings";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {EncounterData, Hero, initHero, normalizeConditions, normalizeLinkRef} from "@drawSteelAdmonition/EncounterData";

export interface PartyData {
    name?: string;
    heroes: Hero[];
}

// Matches the first ```ds-party ... ``` (or ~~~) block in a note
const PARTY_BLOCK_REGEX = /^([`~]{3,})ds-party[ \t]*\n([\s\S]*?)^\1[ \t]*$/m;

/** Key used to find a hero's entry in the party note when writing state back. */
function partyHeroKey(rawHero: any): string | undefined {
    return rawHero?.name ?? normalizeLinkRef(rawHero?.statblock);
}

export async function parsePartyData(source: string, app: App, settings: DSESettings): Promise<PartyData> {
    let data: PartyData;
    try {
        data = (parseYaml(source) ?? {}) as PartyData;
    } catch (error) {
        throw new Error("Invalid YAML format: " + error.message);
    }

    if (typeof data !== "object" || data === null) {
        throw new Error("The input must be a YAML object.");
    }
    if (!data.heroes || !Array.isArray(data.heroes)) {
        throw new Error("Invalid data: 'heroes' field is missing or is not a list.");
    }

    const resolver = new ReferenceResolver(app, settings);
    const names = new Set<string>();
    for (const [index, hero] of data.heroes.entries()) {
        hero.party_key = partyHeroKey(hero);
        await initHero(hero, index, resolver);
        if (names.has(hero.name)) {
            throw new Error(`Party has more than one hero named '${hero.name}'. Hero names must be unique.`);
        }
        names.add(hero.name);
    }

    return data;
}

export class PartyStore {
    /** Finds the note a `party:` reference points to ([[Link]], @path, or a plain path/name). */
    static resolveFile(app: App, ref: string, sourcePath: string): TFile {
        let path = ref.trim();
        if (path.startsWith("[[") && path.endsWith("]]")) {
            path = path.substring(2, path.length - 2);
        } else if (path.startsWith("@")) {
            path = path.substring(1);
        }
        path = path.split("|")[0].split("#")[0].trim();

        const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath)
            ?? app.vault.getAbstractFileByPath(path)
            ?? app.vault.getAbstractFileByPath(path + ".md");
        if (!(file instanceof TFile)) {
            throw new Error(`Party note '${ref}' not found.`);
        }
        return file;
    }

    static async load(app: App, settings: DSESettings, file: TFile): Promise<PartyData> {
        const content = await app.vault.read(file);
        const match = content.match(PARTY_BLOCK_REGEX);
        if (!match) {
            throw new Error(`No ds-party code block found in ${file.path}`);
        }
        try {
            return await parsePartyData(match[2], app, settings);
        } catch (e) {
            throw new Error(`Failed to load party from ${file.path}: ${e.message}`);
        }
    }

    /**
     * Writes the shared state (stamina, temp stamina, recoveries) of the given heroes back to the
     * party note. Only those fields are touched; the rest of the party definition is left as written.
     */
    static async saveHeroes(app: App, file: TFile, heroes: Hero[]): Promise<void> {
        await app.vault.process(file, (content) => {
            const match = content.match(PARTY_BLOCK_REGEX);
            if (!match || match.index == null) {
                console.warn(`Draw Steel Elements: no ds-party block found in ${file.path}. Change NOT saved.`);
                return content;
            }

            const raw = parseYaml(match[2]) ?? {};
            const rawHeroes: any[] = Array.isArray(raw.heroes) ? raw.heroes : [];
            let changed = false;
            heroes.forEach((hero) => {
                const rawHero = rawHeroes.find((entry) => partyHeroKey(entry) === hero.party_key);
                if (!rawHero) {
                    console.warn(`Draw Steel Elements: hero '${hero.name}' not found in ${file.path}. Change NOT saved.`);
                    return;
                }
                rawHero.current_stamina = hero.current_stamina;
                rawHero.temp_stamina = hero.temp_stamina;
                if (hero.max_recoveries != null) {
                    rawHero.current_recoveries = hero.current_recoveries;
                }
                changed = true;
            });
            if (!changed) {
                return content;
            }

            const fence = match[1];
            const block = `${fence}ds-party\n${stringifyYaml(raw).trim()}\n${fence}`;
            return content.substring(0, match.index) + block + content.substring(match.index + match[0].length);
        });
    }
}

/**
 * Loads the party note referenced by `data.party` and puts its heroes at the front of `data.heroes`.
 * Per-encounter state (turn, conditions) comes from the heroes already in `data` if this is a
 * refresh, otherwise from `data.party_state`.
 */
export async function applyParty(data: EncounterData, app: App, settings: DSESettings, sourcePath: string): Promise<void> {
    if (!data.party) {
        return;
    }
    const file = PartyStore.resolveFile(app, data.party, sourcePath);
    const party = await PartyStore.load(app, settings, file);

    const state = Object.assign({}, data.party_state ?? {});
    data.heroes.filter((hero) => hero.from_party).forEach((hero) => {
        state[hero.name] = {has_taken_turn: hero.has_taken_turn, conditions: hero.conditions};
    });
    const localHeroes = data.heroes.filter((hero) => !hero.from_party);

    party.heroes.forEach((hero) => {
        if (localHeroes.some((local) => local.name === hero.name)) {
            throw new Error(`Hero '${hero.name}' is defined both in the encounter and in the party note.`);
        }
        const heroState = state[hero.name];
        hero.from_party = true;
        hero.has_taken_turn = heroState?.has_taken_turn ?? false;
        hero.conditions = normalizeConditions(heroState?.conditions, `hero '${hero.name}'`);
    });

    data.heroes = party.heroes.concat(localHeroes);
}
