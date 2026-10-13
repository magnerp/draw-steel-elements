# Changelog

## Unreleased

## 6.1.0

- Initiative tracker: **Reset Encounter State** now brings every creature back alive at full stamina (re-read from
  its statblock note) instead of clearing them, and resets heroes written in the block to full stamina and
  Recoveries.
- Initiative tracker: new **Save Party State** button. It saves the party heroes' Stamina and Recoveries with the
  encounter, and **Reset Encounter State** restores them.
- Initiative tracker: **keyboard shortcuts**, set in the plugin settings. Click a tracker, then press `D` to open
  the selected creature's stamina window, `K` to kill it, `↓`/`↑` to select the next/previous hero or creature in
  the same group, `→`/`←` to jump to the next/previous group (heroes, then each enemy group), and `R` to reset the
  round.
- Stamina window: type a number in the **Apply** field and press `Enter` to apply it as damage or `Shift+Enter`
  as healing, saving and closing the window. Both keys can be changed in the plugin settings. In a minion squad's
  Stamina Pool modal, when the damage kills some minions, `Enter` moves to the minion checkboxes and saves once
  they're picked.
- New **Hero** element (`ds-hero`): an interactive hero sheet with stats, characteristics, and abilities, plus
  Stamina (stamina window, Spend Recovery), Recoveries, Heroic Resource, Surges, and Victories counters and a
  **Respite** button. Changes are saved back to the block, rewriting only the changed lines.
- Hero sheets: **Free Strikes** shows the hero's standard melee and ranged free strikes (using the higher of Might
  and Agility) and any abilities with `ability_type: Free Strike`.
- Hero sheets: `kit: "[[Mountain]]"` links a kit note. Its Stamina (per echelon), Speed, Stability, damage, and
  distance bonuses are applied, and its signature ability is shown. `[[` after `kit:` suggests kit notes.
- Hero sheets: two kits (a tactician's Field Arsenal) with `kit: ["[[Shining Armor]]", "[[Sniper]]"]`. Both
  signature abilities are shown, and the higher of each bonus applies.
- Party and encounter heroes linked to a hero sheet (`statblock: "[[Cinder]]"`) take their Recoveries from it and
  keep their Stamina and Recoveries on the sheet, shared with every party and encounter.
- Initiative tracker: new **creature view** next to the tracker. Click a hero, a creature, or an enemy group to see
  its statblock (stats and abilities), or a linked hero's sheet.
- Initiative tracker: the tracker and creature view scroll on their own and can be resized (drag the bar between
  them for width, the bar below for height). Sizes are remembered for every tracker.
- Initiative tracker: in the creature view, click the stamina (in the summary or the statblock's Stamina stat,
  which shows current/max) to open the same stamina window as in the tracker. The view no longer flashes, and the
  tracker keeps its scroll position, when a change is saved.
- Hero sheets: an open sheet updates when its note or kit notes change (e.g. Stamina spent in an encounter), and
  its Stamina stat shows current/max.
- Party: **Add Hero** button opens a window asking for the hero's name, max stamina, max Recoveries and an optional
  image (with image suggestions from the vault), and adds them to the party note. Hover a hero and click the **×**
  in its corner to remove them from the party.
- Hero images can be an image name or link (`image: "[[frodo.png]]"`, also unquoted) as well as a full vault
  path or URL.
- Initiative tracker: each creature in the enemy grid shows its name under its image.
- Initiative tracker: more padding inside the **Winded** and **Dying** tags next to stamina.
- Initiative tracker: a creature (not a hero) at 0 stamina now shows **DEAD**, like a dead minion.
- Add Conditions window: the color and effect you pick for a condition are remembered (saved in the plugin
  settings) and used the next time you add that condition, for any creature in any note. **Reset** in the
  customize window goes back to the default look.
- Initiative tracker: middle-click a creature in the enemy grid (or a hero's row) to open the Add Conditions window
  for it, regardless of the current selection.
- Initiative tracker: Ctrl+right-click a creature to kill it. A minion is marked dead on its own and its stamina is
  taken out of the squad's pool.
- Initiative tracker: right-click a creature in the enemy grid to open its stamina window directly (the minion
  stamina pool window for minions), without selecting it first.
- Minion stamina pool window: opens with the "Apply … damage" box focused (like the regular stamina window),
  instead of the pool's current stamina.
- Stamina windows (regular and minion pool): the "Apply" box's value is selected when the window opens, so you
  can type a number straight away.
- Initiative tracker: **Add Enemy Group** button opens a dialog to add a group from statblock notes, with
  monster name suggestions from the vault and a count per creature. `enemy_groups` is now optional.
- Initiative tracker: creatures whose statblock role contains "minion" automatically make their group a squad
  (`is_squad: true`, `squad_role: minion`, and `captain` for one other creature) when that forms a valid squad.
- The `[[` suggestions after `statblock:` now list statblock notes first.
- Initiative tracker / party: `statblock:` and `party:` accept unquoted links (`statblock: [[Thorn Dragon]]`),
  and links with an alias or heading. Typing `[[` after `statblock:` or `party:` inside a `ds-` code block
  now shows note suggestions (Obsidian's own link suggestions don't work in code blocks).
- Statblock references fall back to the note's frontmatter (`item_name`/`name`, `stamina`, `image`) when it has
  no `ds-` code block, so the compendium's retainer statblocks can be referenced.
- Initiative tracker: enemy groups can be removed from the tracker with a trash icon next to the group name
  (shown on hover, asks for confirmation).
- Initiative tracker: no longer flickers after each action (selecting a creature, turns, malice, conditions).
  The re-render after the tracker saves is built from the state it just wrote instead of re-reading notes.
- Minion stamina pool: damage beyond the remaining pool is capped at the pool, so overkill damage can always
  be applied (it kills every remaining minion). Typed stamina values are kept between 0 and the pool max.
- Initiative tracker: creature instances in the enemy group grid (including minions) show their conditions as
  small icons under the portrait.
- Dying heroes: the stamina window's bar turns red when the change would leave a hero dying, and the
  tracker and party rows show a red "Dying" tag (or "Dead") next to the hero's stamina.
- New `ds-party` block: define your heroes once in a party note and link encounters to it with
  `party: "[[Party Note]]"`. Party heroes' stamina, temporary stamina, and Recoveries are shared across
  every linked encounter (saved in the party note); turn markers and conditions stay per encounter.
  The party note has a Respite button to restore all heroes.
- Heroes can track Recoveries (`max_recoveries`, optional `recovery_value`). The stamina window's
  Spend Recovery button uses one up, and the tracker shows a Recoveries counter.
- Initiative tracker: the stamina (damage/healing) modal now shows the Winded value for heroes and
  enemies: a hatched "Winded" zone on the bar, a "Winded at N or less" line (plus the Dying/Dead
  thresholds for heroes), and a live Winded/Dying/Dead badge for the stamina the pending change would
  leave. The remaining-stamina bar turns yellow while winded.
- Initiative tracker: hero and enemy stamina in the tracker rows now shows a "Winded" tag at or below
  half of max stamina. Creatures with `squad_role: minion` never show winded values.

## 6.0.2

- Replaces the bundled zip library (JSZip -> fflate) used by the compendium download. JSZip's
  legacy-browser polyfills contained dynamic `<script>` element creation, which failed
  Obsidian's community-plugin review. No behavior change.
- Adds missing Crafting/Lore skills: Carpentry, Cooking, Strategy (#81)

## 6.0.1

- Identical to 5.1.1. Recovery release for the accidentally published `6.0.0-rc1`; the 6.0.0
  version number is retired.

## 5.1.1

- Corrects issue where double-clicking on an Element in reading mode will open edit mode

## 5.1.0

- Adds support for referencing statblocks within the initiative tracker (see docs for details)

## 5.0.0

- Support for Featureblocks!
- [BREAKING] Statblock CSS changed slightly
  - While this is incredibly minor, it is technically breaking

## 4.1.0

- Corrects an issue with rendering `0` in the values-row element
- Documentation cleanup
- Adds support for a default image in the initiative tracker

## 4.0.0

- [BREAKING] Updates to sdk 2.1.5 (up from v0) to support new schema
  - There are a LOT of changes, please read the [changelog](https://github.com/SteelCompendium/data-sdk-npm/blob/main/CHANGELOG.md)
- Due to changes in the schema, be sure to redownload the compendium 
  - IMPORTANT: this will delete the old compendium!  Be sure none of your homebrew is in that directory!

## 3.4.3

- Correctly supports `ds-negotiation` language

## 3.4.2

- Visual updates to the StaminaBar for the information icon
- Docs updates

## 3.4.1

- Stamina Element Updates
  - Migrated to use Vue
  - Updated visual appearance
  - Updated the modal to be more minimal
  - Temp stamina bar separated

## 3.3.0

- Skill Element updated to support `only_show_selected` to hide unselected skills from the Element
- Begins migrating to Vue
  - Boilerplate implemented
  - Updates Skill Element to use Vue
- New fields for Vue Elements (Currently only Skill Element)
  - `collapsible` (boolean) if `true` allows the Element to collapse
  - `collapse_default` (boolean) if `true` will set the default state of the Element to collapsed when rendered.
  - See the docs for Common Element Fields for details
    
## 3.2.2

- (Quietly) enabling mobile support

## 3.2.1

- Fixes to TestEffect parsing (`data-sdk-npm` `0.0.37`)

## 3.2.0

- Updates to `data-sdk-npm` `0.0.36` to support TestEffects 

## 3.1.0

- Minor updates to the statblock UI

## 3.0.0

- Uses the npm steel-compendium-sdk for parsing
  - Supports latest yaml format for statblocks and abilities

## 2.3.0

- Adds support for Canvas Character Sheets
  - Stamina Bar Element
  - Characteristics Element
  - Counter Element
  - Skills Element
  - Values Row Element

## 2.2.0

- Updates Initiative Element to use `Malice` instead of `VP`
  - Using `villain_power` in the codeblock should still work for now, but it will automatically get rewritten by the element
  - `villain_power` will be removed in `v3`

## 2.1.2

- Compendium Downloader yields to avoid hanging the main thread

## 2.1.1

- [BUGFIX] Correctly displays weaknesses

## 2.1.0

- Adds better error handling on Ability, Negotiation, and Statblock Elements
- Cleanup
- [BUGFIX] Properly handles tiered results in some views

## 2.0.0

- [BREAKING] The Power Roll Element has been replaced by the Ability Element
  - Instead of having a flat structure for the yaml, the `effects` field will list effects, power rolls, etc in an ordered manner
  - As a side effect, the Statblock Element inherits these changes as well
  - For details on the new structure, see the [Ability Documentation](./docs/Abilities.md) 
- Adds ability to [download the Draw Steel Compendium](./docs/compendium-downloader.md)

## 1.6.0

- Adds the statblock element! See the [statblock](./docs/statblock.md) documentation for details!
- Initiative tracker can be triggered with `ds-it` and `ds-initiative-tracker` now

## 1.5.0

- Adds basic support for Negotiation Tracking!

## 1.4.0

- Initiative Tracker
  - Adds basic support for tracking minions!
  - [BUGFIX] Prevents VP text from highlighting when changing
  - [BUGFIX] Allows click-to-remove conditions when blinking

## 1.3.0

- Add ability to reset the encounter

## 1.2.0

- Initiative Tracker
  - Overhauls the condition modal and adds support for customizing the condition appearance 

## 1.1.2

- [BUGFIX] Allow enemies to use recoveries

## 1.1.1

- [BUGFIX] Corrects bugs allowing for non-integer stamina

## 1.1.0

- Adds the Initiative Tracker Element!

## 1.0.2

- Corrects sizing issue on power roll tiers

## 1.0.1

- Cleanup bulleted lists

## 1.0.0

- Adds `horizontal-rule` element
- Adds a ton of new fields to `power-roll` element (See readme)
- [PSEUDO-BREAKING] No longer supports inline-codeblocks for `horizontal-rule`
  - This was unreleased, but for those who built manually...
  - Use a regular multi-line codeblock for functionality
- Adds support for rendering markdown in Power Roll values
- Much more!

## 0.0.6

- Internal cleanup, bugfixes

## 0.0.5

- Avoids innerHTML call for compliance

## 0.0.4

- Prep for inclusion in community plugins

## 0.0.2

- Adds `indent` property to Power Roll Element to support nested lists

## 0.0.1

- Initial release: Power Roll Element basics

