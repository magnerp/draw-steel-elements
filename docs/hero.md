# Hero Element

The Hero Element (`ds-hero`) is an interactive hero sheet: a hero's characteristics, stats, and abilities, plus
everything that changes during play: Stamina, Recoveries, their Heroic Resource, Surges, and Victories. Every
change you make on the sheet is saved back to the code block.

A hero sheet can be linked from a [party](initiative-tracker.md#party-shared-heroes) or an
[Initiative Tracker](initiative-tracker.md) with `statblock: [[Note]]`. The hero's Stamina and Recoveries then
live on the sheet, so spending a Recovery in an encounter shows up on the sheet and in the party, and the other
way around.

## Quick Start Example

```
~~~ds-hero
type: hero
name: Cinder
level: 1
class: Elementalist
subclass: Fire
ancestry: Human
size: 1M
speed: 5
stability: 0
might: 0
agility: 1
reason: 2
intuition: 2
presence: 0
max_stamina: 18
max_recoveries: 8
heroic_resource: Essence
kit: "[[Mountain]]"
features:
  - type: feature
    feature_type: ability
    name: Hurl Element
    icon: 🏹
    ability_type: Free Strike
    keywords: [Magic, Ranged, Strike]
    usage: Main action
    distance: Ranged 10
    target: One creature or object
    effects:
      - roll: Power Roll + 2
        tier1: 4 damage
        tier2: 6 damage
        tier3: 8 damage
~~~
```

Add `type: hero` to the note's frontmatter as well, so the note is suggested when you type `statblock: [[` in a
party or encounter (see [Autocomplete](#autocomplete)).

## Fields

### Definition

- `name` (string, required): The hero's name.
- `max_stamina` (number, required): Maximum Stamina, **without** the kit's Stamina bonus (see [Kits](#kits)).
  `stamina` is accepted as well.
- `level` (number, optional): The hero's level. Used for the header and for the kit's Stamina bonus per echelon.
- `class`, `subclass` (string, optional): Shown in the header, e.g. "Level 1 Elementalist" and "Fire".
- `ancestry` (string or list of strings, optional): Shown in the header.
- `image` (string, optional): The hero's portrait, used by parties and the Initiative Tracker. A vault path, an image
  name or link (`"[[cinder.png]]"`), or a URL.
- `size`, `speed`, `stability` (optional): Shown in the stats row. Write `speed` and `stability` without kit
  bonuses.
- `might`, `agility`, `reason`, `intuition`, `presence` (number, optional): Characteristics.
- `movement`, `immunities`, `weaknesses` (optional): Shown under the stats row, as on a statblock.
- `max_recoveries` (number, optional): The hero's number of Recoveries.
- `recovery_value` (number, optional): Stamina regained when spending a Recovery. Defaults to a third of max
  Stamina (rounded down).
- `heroic_resource` (string, optional): The name of the class's Heroic Resource (e.g. `Essence`, `Wrath`). Defaults
  to "Resource".
- `kit` (link, object, or a list of two, optional): The hero's kit, or both kits of a hero with two. See
  [Kits](#kits). `kits` is accepted as well.
- `features` (list, optional): Traits and abilities, in the same format as a
  [statblock's features](statblock.md). Abilities with `ability_type: Free Strike` are also listed under
  [Free Strikes](#free-strikes).
- `type` (optional): `hero`. Not needed in the `ds-hero` block itself, but it marks the block as a hero sheet when the
  note is linked from a party or encounter. A block with `max_recoveries` or `heroic_resource` is recognized too.

### State (managed)

These are saved by the sheet as you play. You can set them by hand; missing values start at their default.

- `current_stamina` (number): Defaults to max Stamina.
- `temp_stamina` (number): Defaults to `0`.
- `current_recoveries` (number): Defaults to `max_recoveries`.
- `resource` (number): Current Heroic Resource. Defaults to `0`.
- `surges` (number): Defaults to `0`.
- `victories` (number): Defaults to `0`.

The sheet only rewrites these lines (one `key: value` line each) when saving, so the rest of the block, including
your features, comments, and formatting, stays exactly as you wrote it. Only the first `ds-hero` block in a note is
saved to, so use one hero per note.

## Using the Sheet

Under the header is the play bar:

- **Stamina**: Click it to open the stamina window: apply damage or healing, set temporary Stamina, or
  **Spend Recovery** to regain the recovery value. Winded and Dying are shown next to it.
- **Recoveries**: Use **-**/**+** to change the count without changing Stamina. The recovery value is shown next to
  it.
- **Heroic Resource**, **Surges**, **Victories**: **-**/**+** counters. The Heroic Resource can go below 0 (some
  classes allow it); Surges and Victories can't.
- **Free Strikes**: Shows or hides the hero's [free strikes](#free-strikes).
- **Respite**: Restores Stamina and Recoveries to full and removes temporary Stamina.

Below the play bar are the kit (if any), the stats row (Size, Speed, Stamina, Stability), the characteristics,
and the hero's abilities. Heroes have no flat Free Strike value like monsters, so the stats row leaves it out.
The stats row shows Stamina as current/max (e.g. `13/18`, with temporary Stamina as `13 (+5)/18`).

An open sheet updates by itself when its note changes, so Stamina and Recoveries spent in an Initiative Tracker or a
party show up on the sheet right away. It also updates when one of its kit notes changes.

## Free Strikes

**Free Strikes** in the play bar shows the free strikes the hero can make:

- The two standard free strikes every hero has (*Draw Steel*, Chapter 10: Combat):

  | | Distance | Keywords | ≤11 | 12-16 | 17+ |
  |---|---|---|---|---|---|
  | Melee Weapon Free Strike | Melee 1 | Charge, Melee, Strike, Weapon | 2 + M or A | 5 + M or A | 7 + M or A |
  | Ranged Weapon Free Strike | Ranged 5 | Ranged, Strike, Weapon | 2 + M or A | 4 + M or A | 6 + M or A |

  The sheet uses the higher of Might and Agility and shows the totals, including the kit's damage and distance
  bonuses.
- Any of the hero's abilities with `ability_type: Free Strike`, such as an Elementalist's Hurl Element.

## Kits

Link the hero's kit note with `kit`:

```yaml
kit: "[[Mountain]]"
```

The plugin reads the kit's bonuses from its note, in the format the [compendium](compendium-downloader.md) uses
(`**Melee Damage Bonus:** +0/+0/+4` lines), along with its **Signature Ability** section. The kit is then used
throughout the sheet:

- **Stamina**: The kit's Stamina bonus times the hero's echelon is added to `max_stamina` (echelon 1 at levels 1-3,
  2 at 4-6, 3 at 7-9, 4 at level 10). Parties and the Initiative Tracker use this total as well.
- **Speed** and **Stability**: The stats row shows them with the kit's bonuses.
- **Free strikes**: The kit's melee and ranged damage bonuses (per tier) and distance bonuses are added to the
  standard free strikes.
- **Kit line**: Under the play bar, e.g. "Kit: Mountain · Stamina +9 · Stability +2 · Melee damage +0/+0/+4". It also
  lists the Disengage bonus. Click the kit's name to open its note (Ctrl/Cmd+click for a new tab).
- **Signature ability**: Shown after the hero's abilities, rendered from the kit note.

Because the bonuses are added for you, write `max_stamina`, `speed`, and `stability` without them.

A kit without a note can be written out instead. Damage bonuses accept a number for every tier, a
`"+1/+1/+2"` string, or a `[1, 1, 2]` list; the Stamina bonus is per echelon:

```yaml
kit:
  name: Mountain
  stamina_bonus: 9
  speed_bonus: 0
  stability_bonus: 2
  disengage_bonus: 0
  melee_damage_bonus: "+0/+0/+4"
  ranged_damage_bonus: 0
  melee_distance_bonus: 0
  ranged_distance_bonus: 0
```

### Two Kits

Some heroes use two kits, such as a tactician with Field Arsenal. List both:

```yaml
kit:
  - "[[Shining Armor]]"
  - "[[Sniper]]"
```

(`kit: ["[[Shining Armor]]", "[[Sniper]]"]` works too.) Each kit gets its own kit line and signature ability. The
bonuses don't stack: as the rules say, when both kits grant the same benefit you take one or the other, so the
sheet uses the higher of each. Shining Armor and Sniper together give Stamina +12 per echelon, Stability +1,
Speed +1, Disengage +1, melee damage +2/+2/+2, ranged damage +0/+0/+4, and ranged distance +10. For a damage
bonus, the sheet picks the kit whose bonus is higher in total over the three tiers.

If a linked kit note can't be found, the kit line says so.

## Linking a Hero to a Party or Encounter

Link the sheet's note with `statblock`, in a [party](initiative-tracker.md#party-shared-heroes) or in an encounter's
`heroes`:

```
~~~ds-party
name: "The Party"
heroes:
  - statblock: "[[Cinder]]"
~~~
```

- **Definition**: `name`, max Stamina (with the kit), `max_recoveries`, `recovery_value`, and `image` come from the
  sheet. Any of them set on the party or encounter entry takes precedence.
- **Shared state**: The hero's Stamina, temporary Stamina, and Recoveries are always read from and saved to the
  sheet, never to the party note or the encounter. Changes made on the sheet, in the party, or in any encounter
  show up in the others, and open trackers and parties refresh when the sheet changes.
- **Per-encounter state**: Turn markers and conditions stay with each encounter, as for other heroes.
- **Creature view**: Selecting the hero in the Initiative Tracker shows their sheet in the
  [creature view](initiative-tracker.md#creature-view), where the Heroic Resource, Surges, and Victories can be
  changed too (saved to the sheet).

## Autocomplete

Obsidian doesn't suggest links inside code blocks, so the plugin does. Inside a `ds-` code block:

- Type `[[` after `kit:` to get kit notes first (notes with `type: kit` in their frontmatter, as in the compendium).
  This also works for the second kit, in a `kit: [...]` list or a `- "[[...` item under `kit:`.
- Type `[[` after `statblock:` to get statblock notes, including hero sheets with `type: hero` in their frontmatter.
