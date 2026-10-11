import {App, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, setIcon} from "obsidian";
import {RecoveryInfo, StaminaEditModal} from "@views/StaminaEditModal";
import {ConditionManager} from "@utils/Conditions";
import {AddConditionsModal} from "@views/ConditionSelectModal";
import {Images} from "@utils/Images";
import {CodeBlocks} from "@utils/CodeBlocks";
import {Stamina} from "@utils/Stamina";
import {
    Condition,
    Creature,
    CreatureInstance,
    EncounterData,
    EnemyGroup,
    getWrittenEncounter,
    Hero,
    initEnemyGroup,
    parseEncounterData,
    resetEncounter,
} from "./EncounterData";
import {ResetEncounterModal} from "@views/ResetEncounterModal";
import {ConfirmModal} from "@views/ConfirmModal";
import {AddEnemyGroupModal} from "@views/AddEnemyGroupModal";
import {ReferenceResolver} from "@utils/ReferenceResolver";
import {MinionStaminaPoolModal} from "@views/MinionStaminaPoolModal";
import {StaminaBar} from "@model/StaminaBar";
import {applyParty, PartyStore} from "@drawSteelAdmonition/party/PartyData";
import {buildRecoveryControl} from "@drawSteelAdmonition/party/RecoveryControl";
import DrawSteelAdmonitionPlugin from "main";

export class InitiativeProcessor {
    private app: App;
    private plugin: DrawSteelAdmonitionPlugin;
    readonly handler = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => this.postProcess(source, el, ctx);
    private conditionManager: ConditionManager;

    constructor(plugin: DrawSteelAdmonitionPlugin) {
        this.plugin = plugin;
        this.app = plugin.app;
        this.conditionManager = new ConditionManager();
    }

    public async postProcess(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
        const container = el.createEl("div", {cls: "ds-init-container"});

        try {
            // Re-render after our own write: build synchronously from the state we wrote (no flicker)
            let data = getWrittenEncounter(ctx.sourcePath, source);
            if (!data) {
                data = await parseEncounterData(source, this.app, this.plugin.settings);
                await applyParty(data, this.app, this.plugin.settings, ctx.sourcePath);
            }
            this.buildUI(container, data, ctx);
            if (data.party) {
                this.watchParty(container, data, ctx);
            }
            // Avoid clicks in reading mode from opening edit view
            const stop = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
            };
            // container.addEventListener("dblclick", stop, { capture: true });
            container.addEventListener("mousedown", stop, {capture: true});
            container.addEventListener("pointerdown", stop, {capture: true});
        } catch (error) {
            // Display error message to the user
            let userMessage =
                "The Draw Steel Elements plugin loaded the Initiative Tracker properly, but " +
                "failed to process the input config.  Please correct the following error:\n\n";
            userMessage += error.message;
            container.createEl("div", {text: userMessage, cls: "error-message ds-container"});
        }
    }

    /** Re-renders the tracker when the party note changes (e.g. from another encounter or the party view). */
    private watchParty(container: HTMLElement, data: EncounterData, ctx: MarkdownPostProcessorContext): void {
        const partyPath = PartyStore.resolveFile(this.app, data.party!, ctx.sourcePath).path;
        const child = new MarkdownRenderChild(container);
        child.registerEvent(this.app.vault.on("modify", async (file) => {
            if (file.path !== partyPath) return;
            try {
                await applyParty(data, this.app, this.plugin.settings, ctx.sourcePath);
                container.empty();
                this.buildUI(container, data, ctx);
            } catch (e) {
                console.warn("Draw Steel Elements: failed to refresh party heroes.", e);
            }
        }));
        ctx.addChild(child);
    }

    /** Saves a hero's stamina/recoveries: to the party note for party heroes, otherwise to this code block. */
    private async saveHeroStamina(hero: Hero, data: EncounterData, ctx: MarkdownPostProcessorContext): Promise<void> {
        if (hero.from_party && data.party) {
            const file = PartyStore.resolveFile(this.app, data.party, ctx.sourcePath);
            await PartyStore.saveHeroes(this.app, file, [hero]);
        } else {
            await CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
        }
    }

    private buildUI(container: HTMLElement, data: EncounterData, ctx: MarkdownPostProcessorContext): void {
        const topActionBar = container.createEl("div", {cls: "top-action-bar"});

        // Reset Round Button
        const resetRoundButton = topActionBar.createEl("button", {
            text: "Reset Round",
            cls: "reset-round-button",
        });
        resetRoundButton.addEventListener("click", () => {
            // Reset has_taken_turn for heroes
            data.heroes.forEach((hero) => {
                hero.has_taken_turn = false;
            });

            // Reset has_taken_turn for enemy groups
            data.enemy_groups.forEach((group) => {
                group.has_taken_turn = false;
            });

            // Rebuild the UI
            container.empty();
            this.buildUI(container, data, ctx);

            // Update the codeblock
            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
        });

        // Reset Encounter Button
        const resetEncounterButton = topActionBar.createEl("button", {
            text: "Reset Encounter State",
            cls: "reset-encounter-button",
        });
        resetEncounterButton.addEventListener("click", () => {
            new ResetEncounterModal(this.app, () => {
                resetEncounter(data);
                CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
            }).open();
        });

        // Add Enemy Group Button
        const addGroupButton = topActionBar.createEl("button", {
            text: "Add Enemy Group",
            cls: "add-enemy-group-button",
        });
        addGroupButton.addEventListener("click", () => {
            new AddEnemyGroupModal(this.app, this.plugin.settings, async (group) => {
                // Same setup as groups written in the YAML (statblocks, minion squads, instances)
                const resolver = new ReferenceResolver(this.app, this.plugin.settings);
                await initEnemyGroup(group, data.enemy_groups.length, resolver);
                data.enemy_groups.push(group);
                container.empty();
                this.buildUI(container, data, ctx);
                await CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
            }).open();
        });

        // Heroes UI
        const heroesContainer = container.createEl("div", {cls: "heroes-container"});
        const heroesHeader = heroesContainer.createEl("div", {cls: "heroes-header"});
        heroesHeader.createEl("h3", {text: "Heroes"});
        if (data.party) {
            heroesHeader.createEl("span", {
                cls: "party-link-tag",
                text: `Party: ${data.party.replace(/^\[\[|\]\]$/g, "")}`,
                attr: {title: "Stamina and Recoveries of party heroes are shared with every encounter using this party"},
            });
        }

        data.heroes.forEach((hero) => {
            const heroContEl = heroesContainer.createEl("div", {cls: "hero-container"});
            this.buildCharacterRow(heroContEl, hero, data, ctx);
        });

        // Enemies UI
        const enemiesContainer = container.createEl("div", {cls: "enemies-container"});
        const enemyHeader = enemiesContainer.createEl("div", {cls: "enemies-header"});
        enemyHeader.createEl("h3", {text: "Enemy Groups"});

        // Villain Power
        const maliceContainer = enemyHeader.createEl("div", {cls: "malice-container"});
        const maliceModifiers = maliceContainer.createEl("div", {cls: "malice-modifiers"});
        let maliceUp = maliceModifiers.createEl("div", {cls: "malice-modifier"});
        let maliceDown = maliceModifiers.createEl("div", {cls: "malice-modifier"});
        maliceContainer.createEl("div", {cls: "malice-text", text: "Malice: " + data.malice.value});

        setIcon(maliceUp, "chevron-up");
        setIcon(maliceDown, "chevron-down");

        maliceUp.addEventListener("click", () => {
            data.malice.value += 1;
            maliceContainer.setText("Malice: " + data.malice.value);
            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
        });
        maliceDown.addEventListener("click", () => {
            data.malice.value -= 1;
            maliceContainer.setText("Malice: " + data.malice.value);
            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
        });

        data.enemy_groups.forEach((group) => {
            const groupContEl = enemiesContainer.createEl("div", {cls: "enemy-group-container"});
            this.buildEnemyGroupRow(groupContEl, group, data, ctx);
        });
    }

    private buildCharacterRow(
        container: HTMLElement,
        character: Hero,
        data: EncounterData,
        ctx: MarkdownPostProcessorContext
    ): void {
        // Left icons
        const icon = container.createEl("div", {cls: "character-icon"});

        // Turn Indicator
        const turnIndicatorEl = icon.createEl("div", {cls: "turn-indicator"});
        turnIndicatorEl.title = "Toggle to mark turn taken";
        this.updateTurnIndicator(turnIndicatorEl, character.has_taken_turn ?? false);

        // Add click handler to toggle has_taken_turn
        turnIndicatorEl.addEventListener("click", () => {
            if (this.isHero(character)) {
                character.has_taken_turn = !(character.has_taken_turn ?? false);
                this.updateTurnIndicator(turnIndicatorEl, character.has_taken_turn);
                CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
            }
        });

        const rowEl = container.createEl("div", {cls: "character-row"});

        // Middle-click to add conditions to this hero
        rowEl.addEventListener("auxclick", (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            e.stopPropagation();
            this.openAddConditions(character, () => {
                container.empty();
                this.buildCharacterRow(container, character, data, ctx);
                CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
            });
        });

        // Character Image
        const imageEl = rowEl.createEl("div", {cls: "character-image"});
        const imgSrcRaw = character.image ?? null;

        Images.resolveImageSourceOrDefault(this.app, imgSrcRaw, this.plugin.settings.defaultImagePath)
            .then((imgSrc) => {
                imageEl.createEl("img", {attr: {src: imgSrc, alt: character.name}});
            });

        // Middle: Character Info
        const infoEl = rowEl.createEl("div", {cls: "character-info"});

        // Top: Character Name
        let displayName = character.name;
        infoEl.createEl("div", {cls: "character-name", text: displayName});

        // Bottom: Conditions
        const conditionsEl = infoEl.createEl("div", {cls: "character-conditions"});
        this.buildConditionIcons(conditionsEl, character, data, ctx);

        // Right: Health Info and Turn Indicator Container
        const rightContainer = rowEl.createEl("div", {cls: "character-right"});

        // Health Info
        const healthEl = rightContainer.createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});
        this.updateStaminaDisplay(staminaEl, character);

        staminaEl.addEventListener("click", () => {
            let staminaBar = StaminaBar.fromHero(character);
            const modal = new StaminaEditModal(this.app, staminaBar, true, character.name, (result) => {
                staminaBar.updateHero(character);
                if (character.max_recoveries != null) {
                    character.current_recoveries = (character.current_recoveries ?? character.max_recoveries) - result.recoveriesSpent;
                }
                // Recoveries display is rebuilt along with the row
                container.empty();
                this.buildCharacterRow(container, character, data, ctx);
                this.saveHeroStamina(character, data, ctx);
            }, true, this.recoveryInfo(character));
            modal.open();
        });

        buildRecoveryControl(healthEl, character, () => this.saveHeroStamina(character, data, ctx));
    }

    private recoveryInfo(hero: Hero): RecoveryInfo | undefined {
        if (hero.max_recoveries == null) {
            return undefined;
        }
        return {
            current: hero.current_recoveries ?? hero.max_recoveries,
            max: hero.max_recoveries,
            value: Stamina.recoveryValue(hero.max_stamina, hero.recovery_value),
        };
    }

    private buildEnemyGroupRow(
        container: HTMLElement,
        group: EnemyGroup,
        data: EncounterData,
        ctx: MarkdownPostProcessorContext
    ): void {
        // Left icons
        const icon = container.createEl("div", {cls: "enemy-group-icon"});

        // Turn Indicator
        const turnIndicatorEl = icon.createEl("div", {cls: "turn-indicator"});
        turnIndicatorEl.title = "Toggle to mark turn taken";
        this.updateTurnIndicator(turnIndicatorEl, group.has_taken_turn ?? false);

        turnIndicatorEl.addEventListener("click", () => {
            group.has_taken_turn = !(group.has_taken_turn ?? false);
            this.updateTurnIndicator(turnIndicatorEl, group.has_taken_turn);
            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
        });

        const groupEl = container.createEl("div", {cls: "enemy-group"});

        // Group Header with Name and Turn Indicator
        const groupHeader = groupEl.createEl("div", {cls: "group-header"});
        groupHeader.createEl("h4", {text: group.name});

        // Remove the whole group from the encounter
        const removeGroupEl = groupHeader.createEl("div", {cls: "remove-group-btn"});
        setIcon(removeGroupEl, "trash-2");
        removeGroupEl.title = "Remove group from encounter";
        removeGroupEl.addEventListener("click", () => {
            new ConfirmModal(
                this.app,
                "Remove enemy group?",
                `Remove '${group.name}' and all its creatures from this encounter? This can't be undone from the tracker.`,
                "Remove",
                () => {
                    data.enemy_groups = data.enemy_groups.filter((g) => g !== group);
                    container.remove();
                    CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                }
            ).open();
        });

        // Detailed Creature Row Container
        const detailRowContainer = groupEl.createEl("div", {cls: "creature-detail-row"});

        // Determine the selected creature instance
        let selectedInstance: { creature: Creature; instance: CreatureInstance } | null = null;
        if (group.selectedInstanceKey != null) {
            // Try to find the previously selected instance using the unique key
            for (let creatureIndex = 0; creatureIndex < group.creatures.length; creatureIndex++) {
                const creature = group.creatures[creatureIndex];
                if (creature.instances) {
                    const instance = creature.instances.find((inst) => {
                        const instanceKey = `${creatureIndex}-${inst.id}`;
                        return instanceKey === group.selectedInstanceKey;
                    });
                    if (instance) {
                        selectedInstance = {creature, instance};
                        break;
                    }
                }
            }
        }
        if (!selectedInstance) {
            // If no selected instance, default to the first instance
            for (const creature of group.creatures) {
                if (creature.instances && creature.instances.length > 0) {
                    selectedInstance = {creature, instance: creature.instances[0]};
                    break;
                }
            }
        }

        if (selectedInstance) {
            this.buildDetailedCreatureRow(
                detailRowContainer,
                selectedInstance.creature,
                selectedInstance.instance,
                data,
                ctx,
                group
            );
        }

        // If the enemy group contains a single creature, no need for a grid
        if (group.creatures.length === 1 && group.creatures[0].amount === 1) {
            return;
        }

        // Grid of Creature Instances
        const instancesGrid = groupEl.createEl("div", {cls: "creature-instances-grid"});

        // Create cells for all instances of all creatures in the group
        group.creatures.forEach((creature, creatureIndex) => {
            creature.instances?.forEach((instance) => {
                const cellEl = instancesGrid.createEl("div", {cls: "creature-instance-cell"});

                const instanceKey = `${creatureIndex}-${instance.id}`;
                cellEl.dataset.instanceKey = instanceKey;

                // Handle selection highlighting
                if (group.selectedInstanceKey === instanceKey) {
                    cellEl.addClass("selected");
                }

                // Display creature image in the cell
                const imgEl = cellEl.createEl("div", {cls: "instance-image"});
                const imgSrcRaw = creature.image ?? null;
                Images.resolveImageSourceOrDefault(this.app, imgSrcRaw, this.plugin.settings.defaultImagePath)
                    .then((imgSrc) => {
                        imgEl.createEl("img", {attr: {src: imgSrc, alt: creature.name}});
                    })

                // Conditions of this instance, below the image (display only; edit them in the detail row)
                const cellConditionsEl = cellEl.createEl("div", {cls: "instance-conditions"});
                this.buildInstanceConditionIcons(cellConditionsEl, instance);

                // Display health status below the image
                const staminaEl = cellEl.createEl("div", {cls: "instance-stamina"});
                this.updateStaminaDisplay(staminaEl, instance, creature, group);

                // Add click event to update detailed view
                cellEl.addEventListener("click", () => {
                    // Remove 'selected' class from all cells
                    instancesGrid.querySelectorAll(".creature-instance-cell").forEach((cell) => {
                        cell.removeClass("selected");
                    });
                    // Add 'selected' class to the clicked cell
                    cellEl.addClass("selected");

                    // Update the detailed creature row
                    detailRowContainer.empty();
                    this.buildDetailedCreatureRow(detailRowContainer, creature, instance, data, ctx, group);

                    // Persist the selected instance key
                    group.selectedInstanceKey = instanceKey;
                    CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                });

                const openStaminaModal = () => {
                    if (group.is_squad && creature.squad_role === "minion") {
                        const modal = new MinionStaminaPoolModal(this.app, group, creature, data, ctx, () => {
                            container.empty();
                            this.buildUI(container, data, ctx);
                            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                        });
                        modal.open();
                    } else {
                        this.editCreatureStaminaModal(instance, creature, data, ctx, staminaEl, container).open();
                    }
                };

                const rebuildGroup = () => {
                    container.empty();
                    this.buildEnemyGroupRow(container, group, data, ctx);
                    CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                };

                // Double-click (after selecting) or right-click (directly) to edit STAMINA;
                // Ctrl+right-click kills this creature
                cellEl.addEventListener("dblclick", openStaminaModal);
                cellEl.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.ctrlKey) {
                        if (this.killCreatureInstance(group, creature, instance)) {
                            rebuildGroup();
                        }
                    } else {
                        openStaminaModal();
                    }
                });

                // Middle-click to add conditions to this creature (regardless of the selection)
                cellEl.addEventListener("auxclick", (e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    this.openAddConditions(instance, rebuildGroup);
                });
            });
        });
    }

    private buildDetailedCreatureRow(
        container: HTMLElement,
        creature: Creature,
        instance: CreatureInstance,
        data: EncounterData,
        ctx: MarkdownPostProcessorContext,
        group: EnemyGroup
    ): void {
        container.addClass("character-row");

        // Left: Creature Image
        const imageEl = container.createEl("div", {cls: "character-image"});
        const imgSrcRaw = creature.image ?? null;
        Images.resolveImageSourceOrDefault(this.app, imgSrcRaw, this.plugin.settings.defaultImagePath)
            .then((imgSrc) => {
                imageEl.createEl("img", {attr: {src: imgSrc, alt: creature.name}});
            });

        // Middle: Creature Info
        const infoEl = container.createEl("div", {cls: "character-info"});

        // Top: Creature Name (include instance ID)
        infoEl.createEl("div", {cls: "character-name", text: `${creature.name} #${instance.id}`});

        // Bottom: Conditions
        const conditionsEl = infoEl.createEl("div", {cls: "character-conditions"});
        this.buildConditionIcons(conditionsEl, instance, data, ctx, () => {
            const instanceKey = `${group.creatures.indexOf(creature)}-${instance.id}`;
            const cellConditionsEl = container.parentElement?.querySelector(
                `.creature-instance-cell[data-instance-key="${instanceKey}"] .instance-conditions`
            );
            if (cellConditionsEl instanceof HTMLElement) {
                cellConditionsEl.empty();
                this.buildInstanceConditionIcons(cellConditionsEl, instance);
            }
        });

        // Right: Health Info
        const healthEl = container.createEl("div", {cls: "character-health"});
        const staminaEl = healthEl.createEl("div", {cls: "character-stamina"});

        if (group.is_squad && creature.squad_role === "minion") {
            // For minions in a squad, display the pool health
            this.updateStaminaDisplay(staminaEl, instance, creature, group);
            // Add event listener to edit the minion pool stamina
            staminaEl.addEventListener("click", () => {
                const modal = new MinionStaminaPoolModal(this.app, group, creature, data, ctx, () => {
                    container.empty();
                    this.buildDetailedCreatureRow(container, creature, instance, data, ctx, group);
                    CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                });
                modal.open();
            });
        } else {
            // For normal creatures and captains
            this.updateStaminaDisplay(staminaEl, instance, creature, group);
            staminaEl.addEventListener("click", () => {
                this.editCreatureStaminaModal(instance, creature, data, ctx, staminaEl, container).open();
            });
        }
    }

    private editCreatureStaminaModal(
        instance: CreatureInstance,
        creature: Creature,
        data: EncounterData,
        ctx: MarkdownPostProcessorContext,
        staminaEl: HTMLElement,
        container: HTMLElement
    ) {
        const staminaBar = StaminaBar.fromCreature(instance, creature);
        const showWinded = creature.squad_role !== "minion";
        return new StaminaEditModal(this.app, staminaBar, false, creature.name, () => {
            staminaBar.updateCreature(instance);
            this.updateStaminaDisplay(staminaEl, instance, creature);
            CodeBlocks.updateInitiativeTracker(this.app, data, ctx);

            // Update the STAMINA in the grid cell as well
            const gridCell = container.parentElement?.querySelector(
                `.creature-instance-cell:nth-child(${instance.id}) .instance-stamina`
            );
            if (gridCell) {
                this.updateStaminaDisplay(gridCell as HTMLElement, instance, creature);
            }
        }, showWinded);
    }

    private updateTurnIndicator(el: HTMLElement, hasTakenTurn: boolean): void {
        el.empty();
        if (hasTakenTurn) {
            el.addClass("taken-turn");
            setIcon(el, "check");
        } else {
            el.removeClass("taken-turn");
            setIcon(el, "dot");
        }
    }

    private updateStaminaDisplay(
        staminaEl: HTMLElement,
        character: Hero | CreatureInstance,
        creature?: Creature,
        group?: EnemyGroup
    ): void {
        if (group?.is_squad && creature?.squad_role === "minion") {
            // For minions in squads, display the minion stamina pool or DEAD
            if ((character as CreatureInstance).isDead) {
                staminaEl.textContent = `DEAD`;
                staminaEl.style.color = 'crimson';
            } else {
                const currentStamina = group.minion_stamina_pool ?? 0;
                staminaEl.textContent = `${currentStamina}/${creature.max_stamina * creature.amount} (${creature.max_stamina})`;
                staminaEl.style.color = 'var(--text-normal)';
            }
        } else {
            const currentStamina = character.current_stamina ?? 0;
            const tempStamina = character.temp_stamina ?? 0;
            const maxStamina = this.isHero(character)
                ? (character as Hero).max_stamina
                : creature?.max_stamina ?? 0;

            let displayText = `${currentStamina}`;
            if (tempStamina > 0) {
                displayText += `(+${tempStamina})`;
            }
            displayText += `/${maxStamina}`;

            staminaEl.textContent = displayText;

            if (currentStamina < 0) {
                staminaEl.style.color = "red";
            } else if (tempStamina > 0) {
                staminaEl.style.color = "green";
            } else {
                staminaEl.style.color = "";
            }

            // Winded: at or below half of max stamina (heroes and enemies, but not minions)
            const winded = creature?.squad_role !== "minion" && Stamina.isWinded(currentStamina, maxStamina);
            staminaEl.toggleClass("is-winded", winded);
            staminaEl.title = winded ? `Winded (half of ${maxStamina} stamina is ${Stamina.windedThreshold(maxStamina)})` : "";
            if (winded && staminaEl.hasClass("character-stamina")) {
                staminaEl.createEl("span", {cls: "stamina-winded-tag", text: "Winded"});
            }

            // Dying (0 or less) / Dead (negative half of max) only apply to heroes
            if (this.isHero(character) && staminaEl.hasClass("character-stamina")) {
                this.addDyingTag(staminaEl, currentStamina, maxStamina);
            }
        }
    }

    private addDyingTag(staminaEl: HTMLElement, currentStamina: number, maxStamina: number): void {
        const status = Stamina.status(currentStamina, maxStamina, true);
        if (status === "dying" || status === "dead") {
            staminaEl.createEl("span", {cls: "stamina-dying-tag", text: status === "dying" ? "Dying" : "Dead"});
            staminaEl.title = status === "dying"
                ? `Dying (dead at ${Stamina.minimumStamina(maxStamina, true)})`
                : "Dead";
        }
    }

    private buildConditionIcons(
        container: HTMLElement,
        character: Hero | CreatureInstance,
        data: EncounterData,
        ctx: MarkdownPostProcessorContext,
        onChange?: () => void
    ): void {
        const conditions = character.conditions || [];

        conditions.forEach((conditionEntry) => {
            const iconEl = this.renderConditionIcon(container, conditionEntry);
            iconEl?.addEventListener("click", () => {
                character.conditions = conditions.filter((entry) => entry !== conditionEntry);
                container.empty();
                this.buildConditionIcons(container, character, data, ctx, onChange);
                onChange?.();
                CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
            });
        });

        const addConditionEl = container.createEl("div", {cls: "add-condition-icon"});
        setIcon(addConditionEl, "plus-circle");
        addConditionEl.title = "Add Condition";
        addConditionEl.addEventListener("click", () => {
            const addConditionsModal = new AddConditionsModal(
                this.app,
                character,
                this.conditionManager,
                (newConditions) => {
                    character.conditions = (character.conditions || []).concat(newConditions);
                    container.empty();
                    this.buildConditionIcons(container, character, data, ctx, onChange);
                    onChange?.();
                    CodeBlocks.updateInitiativeTracker(this.app, data, ctx);
                }
            );
            addConditionsModal.open();
        });
    }

    /** Opens the Add Conditions modal for a hero or creature; `onAdded` runs after conditions were added. */
    private openAddConditions(character: Hero | CreatureInstance, onAdded: () => void): void {
        new AddConditionsModal(this.app, character, this.conditionManager, (newConditions) => {
            character.conditions = (character.conditions || []).concat(newConditions);
            onAdded();
        }).open();
    }

    /**
     * Kills one creature instance. Regular creatures and captains drop to 0 stamina; a minion is marked
     * dead and its stamina is taken out of the squad's pool. Returns false if there was nothing to do.
     */
    private killCreatureInstance(group: EnemyGroup, creature: Creature, instance: CreatureInstance): boolean {
        const label = `${creature.name} #${instance.id}`;
        if (group.is_squad && creature.squad_role === "minion") {
            if (instance.isDead) {
                new Notice(`${label} is already dead.`);
                return false;
            }
            const aliveMinions = creature.instances?.filter((inst) => !inst.isDead).length ?? 0;
            const pool = group.minion_stamina_pool ?? aliveMinions * creature.max_stamina;
            instance.isDead = true;
            group.minion_stamina_pool = Math.max(0, pool - creature.max_stamina);
        } else {
            if ((instance.current_stamina ?? creature.max_stamina) <= 0 && !instance.temp_stamina) {
                new Notice(`${label} is already dead.`);
                return false;
            }
            instance.current_stamina = 0;
            instance.temp_stamina = 0;
        }
        new Notice(`Killed ${label}`);
        return true;
    }

    /** Small, display-only condition icons for a creature instance cell in the grid. */
    private buildInstanceConditionIcons(container: HTMLElement, instance: CreatureInstance): void {
        (instance.conditions || []).forEach((conditionEntry) => this.renderConditionIcon(container, conditionEntry));
    }

    /** Renders one condition icon (with its color/effect customizations); null if the condition is unknown. */
    private renderConditionIcon(container: HTMLElement, conditionEntry: string | Condition): HTMLElement | null {
        let conditionKey: string;
        let conditionData: Condition | null = null;
        if (typeof conditionEntry === "string") {
            conditionKey = conditionEntry;
        } else if (typeof conditionEntry === "object" && conditionEntry.key) {
            conditionKey = conditionEntry.key;
            conditionData = conditionEntry;
        } else {
            return null;
        }

        const condition = this.conditionManager.getAnyConditionByKey(conditionKey);
        if (!condition) {
            return null;
        }
        const iconEl = container.createEl("div", {cls: "condition-icon"});
        setIcon(iconEl, condition.iconName);
        iconEl.title = condition.displayName;

        // Apply color and effect customizations
        if (conditionData) {
            if (conditionData.color) {
                iconEl.style.color = conditionData.color;
            }
            if (conditionData.effect) {
                iconEl.classList.add(`condition-effect-${conditionData.effect}`);
            }
        }
        return iconEl;
    }

    private isHero(character: Hero | CreatureInstance): character is Hero {
        return "isHero" in character ? character.isHero : false;
    }
}
