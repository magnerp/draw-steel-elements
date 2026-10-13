# Initiative Tracker

The Initiative Tracker helps manage combat encounters efficiently. It provides an interactive interface to track heroes, enemy groups, their health, conditions, and turn order.

The Initiative Tracker uses YAML-defined data to represent the state of an encounter, including heroes, enemy groups, and the villain's power level. The YAML codeblock is where the initial encounter data is configured, but it will also be where state is persisted for easy transfer to other systems via whatever file-sync solution you use.

![initiative-tracker](Media/initiative-tracker.gif)

## Quick Start Example

```
~~~ds-initiative
heroes:
  - name: "Frodo Baggins"
    max_stamina: 80
    image: "images/frodo.png"
  - name: "Samwise Gamgee"
    max_stamina: 90
    image: "images/sam.png"
enemy_groups:
  - name: "Mordor Forces"
    creatures:
      - name: "Orc"
        max_stamina: 40
        amount: 4
        image: "images/orc.png"
      - name: "Troll"
        max_stamina: 150
        amount: 1
        image: "images/troll.png"
malice:
  value: 5
~~~
```

In the above example, there are two Heroes and one Enemy Group (Initiative Groups) named "Mordor Forces," which contains 4 Orcs and 1 Troll. The Villain Power starts at `5`.

## How to Use

To use the Initiative Tracker, you need to include a code block with the `ds-initiative` language identifier in your Obsidian note. Inside this code block, you define your encounter data in YAML format.

In the plugin settings, you can configure a default image to use if none is provided.

### Code Block Structure

```
~~~ds-initiative # Your encounter data here
heroes:
  - name: "Aragorn"
    max_stamina: 120
enemy_groups:
  - name: "Orc Horde"
    creatures:
      - name: "Orc Warrior"
        max_stamina: 50
        amount: 3
malice:
  value: 2
~~~
```

## Encounter Data Format

The encounter data consists of three main sections:

1. **Heroes**: Player characters participating in the encounter.
2. **Enemy Groups**: Groups of enemies, each containing one or more types of creatures. Optional: you can leave
   `enemy_groups` out and add groups from the tracker with **Add Enemy Group**.
3. **Malice**: The current villain power level.

### Heroes

#### Hero Fields

- `name` (string, required): The name of the hero.
- `max_stamina` (number, required): The maximum health points (stamina) of the hero.
- `statblock` (string or object, optional): A reference to a statblock file or an inline statblock object. If provided, `name`, `max_stamina`, and `image` will be populated from the referenced statblock if they are not explicitly set.
  If it links to a [hero sheet](hero.md) (`ds-hero`), Recoveries are filled in as well, and the hero's Stamina and
  Recoveries are saved to the sheet instead of the encounter (see [Linking a Hero](hero.md#linking-a-hero-to-a-party-or-encounter)).
- `current_stamina` (number, optional): The current health points of the hero. Defaults to `max_stamina` if not provided.
- `temp_stamina` (number, optional): Temporary health points (stamina). Defaults to `0`.
- `image` (string, optional): The hero's image: a vault path, an image name or link (`"[[frodo.png]]"`), or a URL.
- `conditions` (list of strings, optional): List of condition keys affecting the hero.
- `max_recoveries` (number, optional): The hero's number of Recoveries. When set, the tracker shows and tracks the hero's remaining Recoveries.
- `current_recoveries` (number, optional): Remaining Recoveries. Defaults to `max_recoveries`.
- `recovery_value` (number, optional): Stamina regained when spending a Recovery. Defaults to a third of `max_stamina` (rounded down).
- `has_taken_turn` (boolean, managed): Indicates if the hero has taken their turn. Managed by the tracker.

#### Example

```yaml
heroes:
  - name: "Gandalf"
    max_stamina: 100
    current_stamina: 85
    temp_stamina: 5
    image: "images/gandalf.png"
    conditions:
      - "blinded"
```

### Party (shared heroes)

Instead of repeating the same heroes in every encounter, define your party once in its own note with a
`ds-party` block, and link encounters to it with the `party` field:

```
~~~ds-party
name: "The Fellowship"
heroes:
  - name: "Frodo Baggins"
    max_stamina: 30
    max_recoveries: 8
    image: "images/frodo.png"
  - statblock: "Heroes/Samwise"
    max_recoveries: 10
~~~
```

```
~~~ds-initiative
party: "[[The Fellowship]]"
enemy_groups:
  - name: "Mordor Forces"
    creatures:
      - name: "Orc"
        max_stamina: 40
        amount: 4
~~~
```

Party heroes use the same fields as [Heroes](#hero-fields). Hero names must be unique within a party.

- **Shared state**: each party hero's stamina, temporary stamina, and Recoveries are saved in the party note,
  not in the encounter. If a hero ends one encounter at 20/30 stamina, they start the next encounter at 20/30.
  Open trackers using the party refresh when the party note changes.
- **Per-encounter state**: turn markers and conditions stay with each encounter (saved under `party_state`,
  managed by the tracker).
- **Extra heroes**: you can still list `heroes` in the encounter (allies, guest heroes). They are shown after the
  party and work as before. `heroes` is optional when `party` is set.
- **Hero sheets**: a party hero linked to a [hero sheet](hero.md) (`statblock: "[[Cinder]]"`) keeps their stamina
  and Recoveries on the sheet instead of the party note. The party, every encounter, and the sheet stay in sync.
- **Reset Encounter State** doesn't touch party heroes' stamina or Recoveries, unless you saved them with
  **Save Party State** (see [Reset Encounter State](#reset-encounter-state)).
- The `party` field accepts a link (`"[[My Party]]"`), a vault path, or a note name. The party note must be a
  regular note (not a canvas card).

The party note itself renders the party: click a hero's stamina to open the stamina window, adjust Recoveries,
or press **Respite** to restore every hero to full stamina and Recoveries (and clear temporary stamina).
Press **Add Hero** to add a hero to the party (name, max stamina, and optionally max Recoveries and an image,
with image suggestions from the vault), or hover a hero
and click the **×** in its corner to remove them from the party. Both edit the `ds-party` block in the note.

### Recoveries

Heroes with `max_recoveries` show a **Recoveries x/y** counter under their stamina, in the tracker and in the
party note. Hover the counter to show **-**/**+** buttons that change the count without changing stamina.

In the stamina window, **Spend Recovery** regains the hero's recovery value and uses up one Recovery
(the button shows how many are left and is disabled at 0). Recoveries are only used when you apply the change.

### Enemy Groups

An enemy group represents a collection of creatures that act together in the initiative order.

#### Enemy Group Fields

- `name` (string, required): The name of the enemy group.
- `creatures` (list of creatures, required): List of creature definitions.
- `is_squad` (boolean, optional): Indicates if the creatures in this group are a squad of minions. Defaults to `false`.
- `minion_stamina_pool` (number, managed): The current combined stamina pool of the minion group. Managed by the tracker.
- `has_taken_turn` (boolean, managed): Indicates if the group has taken a turn. Managed by the tracker.
- `selectedInstanceKey` (string, managed): The key of the currently selected creature instance. Managed by the tracker.

#### Creatures

Each creature in the creatures list has the following fields:

- `name` (string, required): The name of the creature.
- `max_stamina` (number, required): The maximum health points of the creature.
- `statblock` (string or object, optional): A reference to a statblock file or an inline statblock object. If provided, `name`, `max_stamina`, and `image` will be populated from the referenced statblock if they are not explicitly set.
- `amount` (number, required): The number of instances of this creature.
- `instances` (list of CreatureInstance, managed): List of creature instances. Managed by the tracker.
- `image` (string, optional): Path to the creature's image.
- `squad_role` (string, optional): If this Enemy Group is a squad, indicates if the creature role is `captain` or `minion`

#### Creature Instance Fields

- `id` (number, managed): Unique identifier for the instance.
- `current_stamina` (number, managed): Current stamina of the instance.
- `temp_stamina` (number, managed): Current temporary stamina of the instance.
- `isDead` (boolean, managed): Indicates if the creature instance is dead.
- `conditions` (list of strings, managed): Conditions affecting the instance.

#### Example

```yaml
enemy_groups:
  - name: "Goblin Gang"
    creatures:
      - name: "Goblin"
        max_stamina: 30
        amount: 5
        image: "images/goblin.png"
  - name: "Undead Horde"
    is_squad: true
    creatures:
      - name: "Skeleton"
        max_stamina: 10
        amount: 10
        image: "images/skeleton.png"
        squad_role: minion
```

In this example, "Goblin Gang" is a regular enemy group, while "Undead Horde" is a minion group consisting of 10 Skeletons.

### Referencing Statblocks

You can reference existing statblocks to populate creature or hero data (Name, Max Stamina, and Image). This is done using the `statblock` field.

The reference supports multiple formats:

1. **Full Path from vault root**: `Homebrew/monsters/MonsterName.md` (with or without `.md`)
2. **Relative to Compendium root**: `Bestiary/Monsters/MonsterName` (with or without `.md`)
3. **File Name**: `MonsterName` (with or without `.md`) looks for `MonsterName.md` anywhere in the vault 
4. **Link**: `[[MonsterName]]` will use the first found link matching the name. Quotes are optional
   (`statblock: [[MonsterName]]` works), and an alias or heading (`[[MonsterName|Alias]]`) is ignored.
 
**Important:** if using File Name or Link and there are multiple files with the same name, the chosen one is not guaranteed. To ensure the correct file, specify the full path 

**Autocomplete:** Obsidian doesn't suggest links inside code blocks, so the plugin does: type `[[` after `statblock:`
(or `party:`, or `kit:` in a [hero sheet](hero.md)) inside a `ds-` code block to get note suggestions. Pick one to insert `[[Note Name]]`.
Note that links inside code blocks aren't tracked by Obsidian, so they don't show up as backlinks and aren't
updated when you rename the note.

When a statblock is referenced, the plugin will look for the first Draw Steel Element code block (`ds-statblock` or similar) in that file and use its data.
If the note has no such block but has `stamina` in its frontmatter (like the compendium's retainer statblocks), the
name (`item_name`, `name`, or the file name), stamina, and `image` are read from the frontmatter instead.

**Example using references:**

```yaml
...
enemy_groups:
  - name: "Dragon Encounter"
    creatures:
      - statblock: "Thorn Dragon"
        amount: 1
      - statblock: "Bestiary/Monsters/Kobold"
        amount: 5
```

In this case, the `Thorn Dragon`'s name, max stamina (or stamina), and image will be automatically loaded. You can still override these values by explicitly providing them in the YAML.

### Minions and Captains

Minions are groups of weaker creatures that share a combined stamina pool and act together in combat. They are managed differently from regular creatures in the Initiative Tracker.

To define a minion group, set the `is_squad` field to `true` in the enemy group definition.  In a `creature` object, set the `squad_role` field to `minion`.  

Additionally, you can add another `creature` object to the Enemy group (squad) and set its `squad_role` to `captain`.  This has no effect right now, but may change in the future.

**Automatic squads:** when a creature references a statblock whose role contains "minion" (for example
`Minion Artillery`), the group is made a squad automatically: `is_squad` is set to `true`, the minion creature gets
`squad_role: minion`, and another creature in the group (if any) gets `squad_role: captain`. This only happens when
the group forms a valid squad (one minion creature type plus at most one other creature); other groups are left as
written. `squad_role`s you set yourself are kept.

### Malice

#### Fields

- `value` (number, required): The current villain power level.

#### Example

```yaml
malice:   
  value: 3
```

## Interacting with the Tracker

Once your encounter is defined, the Initiative Tracker provides an interactive UI in your note: the tracker itself
(heroes, enemy groups, Malice) and, next to it, the [creature view](#creature-view) showing the selected hero's or
creature's stats and abilities.

### Heroes

- **Turn Indicator**: Click on the circle icon next to a hero's name to mark whether they have taken their turn.
- **Stamina Management**: Click on the hero's stamina display to open a modal where you can:
	- Apply damage or healing.
	- Adjust temporary stamina points.
- **Conditions**: Add or remove conditions affecting the hero. Middle-click a hero's row to open the Add Conditions
  window directly.

### Enemy Groups

- **Turn Indicator**: Similar to heroes, click on the circle icon next to the enemy group's name.
- **Remove Group**: Hover over a group and click the trash icon next to its name to remove the whole group (all its
  creatures) from the encounter. You'll be asked to confirm.
- **Creature Grid**:
	- **Selection**: Click on a creature instance to view its details.
	- **Conditions**: Each instance's conditions show as small icons under its portrait. Add or remove them in the
	  details row of the selected instance.
	- **Health Management**:
		- **Regular Creatures**: Double-click on a creature instance to open the health management modal, or
		  right-click it to open the modal directly without selecting it first.
		- **Minions**: Click on the stamina display of the minion group to open the Minion Stamina Pool modal, or
		  right-click any minion in the grid.
	- **Kill**: Ctrl+right-click a creature to kill it. Regular creatures and captains drop to 0 stamina. For a
	  minion, only that minion is marked dead and its stamina (one minion's max stamina) is taken out of the squad's
	  pool, so earlier damage carries over (e.g. 4 minions with 3 stamina at 10/12: killing one leaves 7/9).
	- **Conditions**: Middle-click a creature to open the Add Conditions window for it, without selecting it.

### Creature View

The creature view sits to the right of the tracker and shows whoever you select:

- **Selecting**: Click a hero's row, a creature in a group's grid, or a group's details row. Clicking anywhere else
  on an enemy group selects the creature in its details row: the only creature in the group, or the one last
  selected in its grid. The selected row or cell is highlighted. Click the **×** in the view to clear it.
- **Summary**: The top of the view shows the portrait, name (and instance number), group, stamina (with Winded,
  Dying, or DEAD), conditions, and, for heroes, Recoveries. Click the stamina to open the same stamina window as in
  the tracker (damage, healing, temporary Stamina, and Spend Recovery for heroes; the Stamina Pool modal for squad
  minions). Conditions are changed in the tracker.
- **Stamina stat**: In the statblock's stats row, Stamina shows the selected hero's or creature's current/max Stamina
  (the minion pool for squad minions) instead of the statblock's max. Clicking it opens the same stamina window.
- **Statblock**: Below the summary is the statblock the hero or creature links to with `statblock`, rendered like a
  [Statblock Element](statblock.md): stats, characteristics, and all abilities. A linked `ds-featureblock` is shown
  as a [featureblock](featureblock.md). A hero linked to a [hero sheet](hero.md) shows the sheet, where the Heroic
  Resource, Surges, Victories, and free strikes are available. Without a `statblock`, the view says so.
- The selection isn't saved in the code block. It's remembered per note while Obsidian is open, so it stays put
  when the tracker saves and refreshes.

#### Keyboard Shortcuts

Click anywhere on a tracker to send keyboard shortcuts to it; it gets an outline. Clicking anywhere outside it (for
example back into the note's text) turns them off, so they don't get in the way of typing.

| Default | Action |
|---|---|
| `D` | Open the stamina window (damage, healing) of the selected hero or creature |
| `K` | Kill the selected creature (not heroes), like Ctrl+right-click |
| `↓` / `↑` | Select the next / previous hero, or the next / previous creature in the selected creature's group (wraps around) |
| `→` / `←` | Select the next / previous group: the heroes (first hero), then each enemy group (the creature in its details row). Wraps around, and works with nothing selected |
| `R` | Reset Round |

In the stamina window, type a number in the **Apply** field (it has focus when the window opens) and press `Enter`
to apply it as damage, or `Shift+Enter` to apply it as healing. Either one saves and closes the window, so `D`,
a number, and `Enter` damages the selected creature without touching the mouse.

The Stamina Pool modal of a minion squad works the same way (`Enter` deals the number to the given count of minions,
`Shift+Enter` heals the pool by it). If the damage kills some, but not all, of the remaining minions, focus moves to
the minion checkboxes instead: pick which ones die (Tab, Space), then press `Enter` to save.

Change them in **Settings → Draw Steel Elements → Initiative Tracker → Keyboard Shortcuts**: click a shortcut and
press the new key (with Ctrl, Alt, Shift, if you like; Escape cancels). The arrow resets it to its default and the
**×** turns it off.

#### Layout, Resizing, and Scrolling

- The tracker and the creature view each scroll on their own, so scrolling a long list of enemy groups doesn't
  scroll the note.
- Drag the bar between them to change how much width each gets, and drag the bar below them to change their
  height. The sizes are saved in the plugin's settings and used by every Initiative Tracker.
- When the tracker is narrower than about 760px, the creature view moves below the tracker instead. Obsidian's
  **Readable line length** setting limits notes to about that width, so turn it off to have them side by side.

### Stamina Pool Modal for Minions

The Stamina Pool modal for Minions allows you to manage the combined stamina of a minion group.  This modal works similarly to the Stamina Modals for normal creatures, but has some additional functionality.

When the Stamina Pool of minions gets reduced to thresholds that would kill a minion, the modal will allow the user to select which minion to kill.  The modal has some guardrails in place to help ensure the Director is following minion rules, but its not perfect and there is some flexibility. 

![minion-stamina-pool-modal](Media/minion-stamina-pool-modal.png)

### Malice

**Adjusting**: Use the up and down arrows next to the villain power display to increase or decrease the value.

### Add Enemy Group

Click **Add Enemy Group** at the top of the tracker to add a group without editing the YAML:

1. Optionally enter a group name (it defaults to the first creature's name).
2. In each creature row, start typing a monster name to get suggestions from the statblock notes in your vault
   (notes with `stamina` in their frontmatter, or with "statblock" in their path), and set how many to add.
   Once a statblock is picked, the row shows its stamina and a **Minion** tag for minions.
3. Use **Add creature** for more creature types in the same group (for example minions and their captain).
4. Click **Add Group**.

The group is set up the same way as one written in the YAML, including [automatic squads](#minions-and-captains)
for minion statblocks.

### Reset Round

Click the "Reset Round" button to clear all turn indicators and start a new round.

### Reset Encounter State

Click the "Reset Encounter State" button to put the encounter back to its starting state. Every creature comes back
alive at full stamina (its max stamina is re-read from its statblock note), and all conditions, turns, and Malice
are cleared. Heroes written in the tracker block go back to full stamina and Recoveries. **Warning: this is a
destructive operation**

Heroes from a party note or linked to a hero sheet keep their stamina and Recoveries, since those are shared across
encounters. To be able to restore them, click **Save Party State** at the start of the encounter: it saves their
current Stamina, temporary Stamina, and Recoveries in the encounter block (`party_snapshot`), and **Reset Encounter
State** then brings them back to it, updating the party note and hero sheets. Click it again to replace the saved
state. The button only appears when the encounter has such heroes.

### Stamina Management

![initiative-tracker-stamina-modal.png](Media/initiative-tracker-stamina-modal.png)

#### Adjusting Stamina Incrementally

- Use the **"+"** and **"-"** buttons next to the stamina value to increment or decrement by 1.
- Alternatively, edit the stamina value directly in the input field.

#### Applying Specific Damage or Healing

1. **Enter Amount**: Input the amount in the "Apply" field.
2. **Click "Damage" or "Healing"**:
	- **Damage**: Reduces temporary stamina first, then reduces current stamina.

#### Managing Temporary Stamina

- Use the **"+"** and **"-"** buttons next to the temporary stamina value.
- Edit the temporary stamina value directly in the input field.

#### Quick Modifiers

- **Kill**: Sets current stamina to zero (creatures) or negative half maximum stamina (heroes), removes all temporary stamina.
- **Full Heal**: Restores current stamina to maximum.
- **Spend Recovery**: Increases current stamina by one-third of the maximum stamina (or the hero's
  `recovery_value`). For heroes with `max_recoveries`, it also uses up one of their Recoveries.

#### Winded

A hero or creature is *winded* when its stamina is equal to or less than half of its maximum (rounded down).
The stamina modal shows this for both heroes and enemies:

- A hatched **Winded** zone on the stamina bar.
- A line under the bar with the threshold (for example, "Winded at 40 or less"). For heroes this also lists the
  Dying (0 or less) and Dead (negative half maximum) thresholds.
- A live badge (**Winded**, **Dying**, or **Dead**) for the stamina the pending change would leave. The remaining
  stamina on the bar turns yellow while winded, and red while a hero is dying.

In the tracker itself, a hero or enemy at or below the winded threshold gets a **Winded** tag next to their stamina.
A hero at 0 stamina or less gets a red **Dying** tag instead (or **Dead** at negative half their maximum).
A creature that isn't a hero shows **DEAD** at 0 stamina, like a dead minion.
Winded status is display only; it does not add the Winded condition for you. Creatures with `squad_role: minion`
never show winded values (in the modal or the tracker), since minions don't use them. Captains and other creatures do.

### Conditions

Conditions represent status effects affecting heroes or creatures, such as "dazed" or "slowed".

![initiative-tracker-add-conditions](Media/initiative-tracker-add-conditions.png)

Adding a Condition to a Hero or Creature:

- Click the "+" icon in the conditions section.
- Select conditions from the list by clicking them.
- Click "Add Conditions".

Optionally, you can customize the appearance of the condition:

- Open the condition customization modal:
	- Click the "cog" icon when hovering over the condition in the "Add Conditions" modal **OR**
	- Double-click the condition in the "Add Conditions" modal.
- Change the color or effect with the provided selectors.

The color and effect you save are remembered for that condition, so it looks the same the next time you add it
to any hero or creature, in any note. Click **Reset** in the customization modal to go back to the default look.

Removing a Condition:

- Click on the condition icon to remove it.

### Data Persistence

All interactions with the tracker update the underlying YAML data in the code block. This ensures that your encounter state is preserved even after closing and reopening the note.
