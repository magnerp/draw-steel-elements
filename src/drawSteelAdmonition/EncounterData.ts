import {App, parseYaml} from "obsidian";
import {DSESettings} from "@model/Settings";
import {ReferenceResolver} from "@utils/ReferenceResolver";

export interface Hero {
    name: string;
    max_stamina: number;
    current_stamina?: number;
    temp_stamina?: number;
    image?: string;
    isHero: boolean;
    has_taken_turn?: boolean;
    conditions: (string | Condition)[];
    statblock?: any; // To allow property fallback
    max_recoveries?: number;
    current_recoveries?: number;
    recovery_value?: number; // Defaults to a third of max stamina
    // Runtime only (never serialized): set for heroes loaded from a ds-party note
    from_party?: boolean;
    party_key?: string;
}

// Per-encounter state for party heroes. Stamina and recoveries live in the party note instead.
export interface PartyHeroState {
    has_taken_turn?: boolean;
    conditions?: (string | Condition)[];
}

export interface CreatureInstance {
    id: number;
    current_stamina?: number;
    temp_stamina?: number;
    conditions?: (string | Condition)[];
    isDead?: boolean;
}

export interface Creature {
    name: string;
    max_stamina: number;
    amount: number;
    instances?: CreatureInstance[];
    image?: string;
    isHero: boolean;
    squad_role?: "minion" | "captain";
    statblock?: any; // To allow property fallback
}

export interface EnemyGroup {
    name: string;
    creatures: Creature[];
    has_taken_turn?: boolean;
    selectedInstanceKey?: string;
    is_squad?: boolean;
    minion_stamina_pool?: number;
}

export interface Malice {
    value: number;
}

export interface Condition {
    key: string;
    color?: string;
    effect?: string;
}

export interface EncounterData {
    party?: string; // Link to a note containing a ds-party block
    party_state?: Record<string, PartyHeroState>;
    heroes: Hero[];
    enemy_groups: EnemyGroup[];
    // REVIEW: should we make this into a number since Malice is only {value: number}?
    malice: Malice;
}

export function resetEncounter(data: EncounterData) {
    data.heroes.forEach((hero) => {
        hero.has_taken_turn = undefined;
        hero.conditions = Array<Condition | string>();
        // Party heroes keep their stamina and recoveries; those are shared across encounters
        if (!hero.from_party) {
            hero.current_stamina = undefined;
            hero.temp_stamina = undefined;
            hero.current_recoveries = undefined;
        }
    });
    data.enemy_groups.forEach((group) => {
        group.has_taken_turn = undefined;
        group.selectedInstanceKey = undefined;
        if (group.is_squad) {
            group.minion_stamina_pool = undefined;
        }
        group.creatures.forEach((creatureType) => {
            creatureType.instances = undefined;
        });
    });
    data.malice.value = 0;
}

/**
 * An unquoted `[[Note]]` in YAML parses as a nested list (`[["Note"]]`); turn it back into the
 * link string `"[[Note]]"`. Anything else is returned unchanged.
 */
export function normalizeLinkRef(value: any): any {
    if (!Array.isArray(value)) {
        return value;
    }
    let inner: any = value;
    while (Array.isArray(inner) && inner.length === 1) inner = inner[0];
    return typeof inner === "string" ? `[[${inner}]]` : value;
}

export function normalizeConditions(conditions: (string | Condition)[] | undefined, owner: string): Condition[] {
    return conditions?.map((cond) => {
        if (typeof cond === "string") {
            return {
                key: cond,
                color: undefined,
                effect: undefined
            }
        } else if (typeof cond === "object" && cond.key) {
            return {
                key: cond.key,
                color: cond.color ?? undefined,
                effect: cond.effect ?? undefined,
            };
        } else {
            throw new Error(`Invalid condition format for ${owner}.`);
        }
    }) ?? [];
}

export async function initHero(hero: Hero, index: number, resolver: ReferenceResolver): Promise<void> {
    hero.statblock = normalizeLinkRef(hero.statblock);
    if (typeof hero.statblock === 'string') {
        try {
            const resolved = await resolver.resolveReferences(hero.statblock);
            if (resolved) {
                if (!hero.name && resolved.name) hero.name = resolved.name;
                if (!hero.max_stamina && resolved.stamina) hero.max_stamina = +resolved.stamina;
                if (!hero.image && resolved.image) hero.image = resolved.image;
            }
        } catch (e) {
            const message = `
Failed to resolve hero statblock reference at index ${index} (${hero.statblock}):
    ${e.message}

Are there multiple instances of the '${hero.statblock}' file in your vault? If so, please specify the full path.
`;
            throw new Error(message);
        }
    }

    if (!hero.name) {
        throw new Error(`Hero at index ${index} is missing the 'name' field.`);
    }
    if (typeof hero.max_stamina !== "number") {
        throw new Error(`Hero '${hero.name}' is missing or has an invalid 'max_stamina' field.`);
    }
    if (hero.max_recoveries != null && typeof hero.max_recoveries !== "number") {
        throw new Error(`Hero '${hero.name}' has an invalid 'max_recoveries' field.`);
    }
    if (hero.recovery_value != null && typeof hero.recovery_value !== "number") {
        throw new Error(`Hero '${hero.name}' has an invalid 'recovery_value' field.`);
    }

    hero.conditions = normalizeConditions(hero.conditions, `hero '${hero.name}'`);

    hero.isHero = true;
    hero.has_taken_turn = hero.has_taken_turn ?? false;
    hero.current_stamina = hero.current_stamina ?? hero.max_stamina;
    hero.temp_stamina = hero.temp_stamina ?? 0;
    if (hero.max_recoveries != null) {
        hero.current_recoveries = hero.current_recoveries ?? hero.max_recoveries;
    }
}

/**
 * Builds the object written back to the ds-initiative code block. Party heroes are left out of
 * `heroes`; only their per-encounter state (turn, conditions) is kept, under `party_state`.
 */
export function serializeEncounter(data: EncounterData): any {
    const out: any = {};
    if (data.party) {
        out.party = data.party;
    }
    out.heroes = data.heroes.filter((hero) => !hero.from_party).map((hero) => {
        const {from_party, party_key, ...rest} = hero;
        return rest;
    });
    if (data.party) {
        const state: Record<string, PartyHeroState> = {};
        data.heroes.filter((hero) => hero.from_party).forEach((hero) => {
            state[hero.name] = {has_taken_turn: hero.has_taken_turn, conditions: hero.conditions};
        });
        out.party_state = state;
    }
    Object.keys(data).forEach((key) => {
        if (!(key in out) && key !== "party_state") {
            out[key] = (data as any)[key];
        }
    });
    return out;
}

// The encounter state the tracker just wrote to a code block, keyed by note path and block text.
// Writing the block makes Obsidian re-render it; building that render from this copy (synchronously,
// instead of re-parsing and re-reading statblock/party notes) keeps the tracker from flickering.
// Entries are short-lived so a later render (e.g. reopening the note after the party note changed)
// always re-reads everything.
const renderCache = new Map<string, {data: EncounterData, writtenAt: number}>();
const RENDER_CACHE_TTL_MS = 5000;

function renderCacheKey(sourcePath: string, blockText: string): string {
    return `${sourcePath}\n${blockText.trim()}`;
}

export function rememberWrittenEncounter(sourcePath: string, blockText: string, data: EncounterData): void {
    const now = Date.now();
    renderCache.forEach((entry, key) => {
        if (now - entry.writtenAt > RENDER_CACHE_TTL_MS) renderCache.delete(key);
    });
    renderCache.set(renderCacheKey(sourcePath, blockText), {data: structuredClone(data), writtenAt: now});
}

/** A fresh copy of the encounter the tracker just wrote as `blockText`; undefined if it didn't (recently). */
export function getWrittenEncounter(sourcePath: string, blockText: string): EncounterData | undefined {
    const entry = renderCache.get(renderCacheKey(sourcePath, blockText));
    if (!entry || Date.now() - entry.writtenAt > RENDER_CACHE_TTL_MS) {
        return undefined;
    }
    return structuredClone(entry.data);
}

export async function parseEncounterData(source: string, app: App, settings: DSESettings): Promise<EncounterData> {
    let data: EncounterData;

    // Try parsing the YAML input
    try {
        data = parseYaml(source) as EncounterData;
    } catch (error) {
        throw new Error("Invalid YAML format: " + error.message);
    }

    const resolver = new ReferenceResolver(app, settings);

    // Validate that data is an object
    if (typeof data !== "object" || data === null) {
        throw new Error("The input must be a YAML object.");
    }

    // An unquoted [[Link]] parses as a nested list
    data.party = normalizeLinkRef(data.party);
    if (data.party != null && typeof data.party !== "string") {
        throw new Error("Invalid data: 'party' must be a link to a note containing a ds-party block.");
    }

    // Validate 'heroes' field (optional when the heroes come from a party note)
    if (data.party && data.heroes == null) {
        data.heroes = [];
    }
    if (!data.heroes || !Array.isArray(data.heroes)) {
        throw new Error("Invalid data: 'heroes' field is missing or is not a list.");
    }

    // Validate 'enemy_groups' field
    if (!data.enemy_groups || !Array.isArray(data.enemy_groups)) {
        throw new Error("Invalid data: 'enemy_groups' field is missing or is not a list.");
    }

    // Initialize heroes
    for (const [index, hero] of data.heroes.entries()) {
        await initHero(hero, index, resolver);
    }

    // Initialize enemy groups and creatures
    for (const [groupIndex, group] of data.enemy_groups.entries()) {
        if (!group.name) {
            throw new Error(`Enemy group at index ${groupIndex} is missing the 'name' field.`);
        }
        if (!group.creatures || !Array.isArray(group.creatures)) {
            throw new Error(`Enemy group '${group.name}' has an invalid or missing 'creatures' field.`);
        }

        group.has_taken_turn = group.has_taken_turn ?? false;
        group.is_squad = group.is_squad ?? false;

        if (group.is_squad) {
            // Squad-specific validation
            if (group.creatures.length > 2) {
                throw new Error(
                    `Squad '${group.name}' can have at most two creatures (minions and an optional captain).`
                );
            }
            let minionCount = 0;
            let captainCount = 0;
            group.creatures.forEach((creature) => {
                if (!creature.squad_role) {
                    throw new Error(
                        `Creature '${creature.name}' in squad '${group.name}' must have a 'squad_role' of 'minion' or 'captain'.`
                    );
                }
                if (creature.squad_role === "minion") {
                    minionCount += 1;
                } else if (creature.squad_role === "captain") {
                    captainCount += 1;
                } else {
                    throw new Error(
                        `Creature '${creature.name}' in squad '${group.name}' has an invalid 'squad_role' value.`
                    );
                }
            });
            if (minionCount === 0) {
                throw new Error(`Squad '${group.name}' must have at least one minion creature.`);
            }
            if (minionCount > 1) {
                throw new Error(`Squad '${group.name}' can have only one minion creature type.`);
            }
            if (captainCount > 1) {
                throw new Error(`Squad '${group.name}' can have at most one captain creature.`);
            }
        }

        for (const [creatureIndex, creature] of group.creatures.entries()) {
            creature.statblock = normalizeLinkRef(creature.statblock);
            if (typeof creature.statblock === 'string') {
                try {
                    const resolved = await resolver.resolveReferences(creature.statblock);
                    if (resolved) {
                        if (!creature.name && resolved.name) creature.name = resolved.name;
                        if (!creature.max_stamina && resolved.stamina) creature.max_stamina = +resolved.stamina;
                        if (!creature.image && resolved.image) creature.image = resolved.image;
                    }
                } catch (e) {
                    const message = `
Failed to resolve creature statblock reference at index ${creatureIndex} (${creature.statblock}):
    ${e.message}

Are there multiple instances of the '${creature.statblock}' file in your vault? If so, please specify the full path.
`;
                    throw new Error(message);
                }
            }

            if (!creature.name) {
                throw new Error(
                    `Creature at index ${creatureIndex} in group '${group.name}' is missing the 'name' field.`
                );
            }
            if (typeof creature.amount !== "number") {
                throw new Error(
                    `Creature '${creature.name}' in group '${group.name}' is missing or has an invalid 'amount' field.`
                );
            }
            if (typeof creature.max_stamina !== "number") {
                throw new Error(
                    `Creature '${creature.name}' in group '${group.name}' is missing or has an invalid 'max_stamina' field.`
                );
            }

            creature.isHero = false;

            // Initialize instances
            if (group.is_squad && creature.squad_role === "minion") {
                // For minions in a squad, they share a stamina pool
                // Initialize the shared stamina pool
                if (group.minion_stamina_pool == null) {
                    // Initialize the pool to total stamina (max_stamina * amount)
                    group.minion_stamina_pool = creature.max_stamina * creature.amount;
                }
                // Initialize instances for minions (for conditions only)
                if (!creature.instances || creature.instances.length !== creature.amount) {
                    creature.instances = [];
                    for (let i = 0; i < creature.amount; i++) {
                        creature.instances.push({
                            id: i + 1,
                            conditions: [],
                            // current_stamina and temp_stamina are not used for minions in squads
                        });
                    }
                } else {
                    // Validate existing instances
                    creature.instances.forEach((instance, instanceIndex) => {
                        if (typeof instance.id !== "number") {
                            throw new Error(
                                `Instance at index ${instanceIndex} of creature '${creature.name}' in group '${group.name}' is missing or has an invalid 'id' field.`
                            );
                        }
                        // For minions, we don't need to set current_stamina or temp_stamina
                        // Update conditions handling
                        instance.conditions =
                            instance.conditions?.map((cond) => {
                                if (typeof cond === "string") {
                                    return {
                                        key: cond,
                                        color: undefined,
                                        effect: undefined
                                    }
                                } else if (typeof cond === "object" && cond.key) {
                                    return {
                                        key: cond.key,
                                        color: cond.color ?? undefined,
                                        effect: cond.effect ?? undefined,
                                    };
                                } else {
                                    throw new Error(
                                        `Invalid condition format for instance '${instance.id}' of creature '${creature.name}'.`
                                    );
                                }
                            }) ?? [];
                    });
                }
            } else {
                // For regular creatures and captains
                if (!creature.instances || creature.instances.length !== creature.amount) {
                    creature.instances = [];
                    for (let i = 0; i < creature.amount; i++) {
                        creature.instances.push({
                            id: i + 1,
                            current_stamina: creature.max_stamina,
                            temp_stamina: 0,
                            conditions: [],
                        });
                    }
                } else {
                    // Validate existing instances
                    creature.instances.forEach((instance, instanceIndex) => {
                        if (typeof instance.id !== "number") {
                            throw new Error(
                                `Instance at index ${instanceIndex} of creature '${creature.name}' in group '${group.name}' is missing or has an invalid 'id' field.`
                            );
                        }
                        instance.current_stamina = instance.current_stamina ?? creature.max_stamina;
                        instance.temp_stamina = instance.temp_stamina ?? 0;
                        // Update conditions handling
                        instance.conditions =
                            instance.conditions?.map((cond) => {
                                if (typeof cond === "string") {
                                    return {
                                        key: cond,
                                        color: undefined,
                                        effect: undefined
                                    }
                                } else if (typeof cond === "object" && cond.key) {
                                    return {
                                        key: cond.key,
                                        color: cond.color ?? undefined,
                                        effect: cond.effect ?? undefined,
                                    };
                                } else {
                                    throw new Error(
                                        `Invalid condition format for instance '${instance.id}' of creature '${creature.name}'.`
                                    );
                                }
                            }) ?? [];
                    });
                }
            }
        }
    }

    data.malice = data.malice ?? {value: 0};
    if (typeof data.malice.value !== "number") {
        throw new Error("Invalid data: 'malice.value' must be a number.");
    }

    return data;
}
