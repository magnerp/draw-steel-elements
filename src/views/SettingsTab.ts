import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import DrawSteelAdmonitionPlugin from "main";
import {CompendiumDownloader} from "@utils/CompendiumDownloader";
import {DEFAULT_HOTKEYS, InitiativeHotkeyAction} from "@model/Settings";
import {HOTKEY_ACTIONS, hotkeyFor, hotkeyFromEvent} from "@utils/Hotkeys";

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: DrawSteelAdmonitionPlugin;

	constructor(app: App, plugin: DrawSteelAdmonitionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl('h3', { text: 'Draw Steel Compendium Downloader' });
		containerEl.createEl('p', { text: 'Important: The Compendium will download to a specific directory in your vault and delete any files in that directory' });

		new Setting(containerEl)
			.setName('Release Tag (Optional)')
			.setDesc(
				'Specific release tag to download. Leave empty to download the latest release.'
			)
			.addText(text =>
				text
					.setPlaceholder('v1.0.0')
					.setValue(this.plugin.settings.compendiumReleaseTag ?? "")
					.onChange(async value => {
						this.plugin.settings.compendiumReleaseTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Destination Directory')
			.setDesc('Directory within your vault to extract the Compendium contents to.  THIS DIRECTORY WILL BE WIPED CLEAN!')
			.addText(text =>
				text
					.setPlaceholder('ImportedContent')
					.setValue(this.plugin.settings.compendiumDestinationDirectory)
					.onChange(async value => {
						this.plugin.settings.compendiumDestinationDirectory = value;
						await this.plugin.saveSettings();
					})
			);

		const downloadButton = containerEl.createEl('button', { cls: 'settings-action-button', text: 'Download Compendium' });
		downloadButton.addEventListener("click", () => {
			return new CompendiumDownloader(this.app, this.plugin.githubOwner, this.plugin.githubRepo, undefined)
				.downloadAndExtractRelease(this.plugin.settings.compendiumReleaseTag, this.plugin.settings.compendiumDestinationDirectory);
		});

		containerEl.createEl('h3', { text: 'Initiative Tracker' });

		new Setting(containerEl)
			.setName('Default Creature Image Path')
			.setDesc('Default image to use for creatures in the initiative tracker if not specified')
			.addText(text =>
				text
					.setPlaceholder('path/to/image.png')
					.setValue(this.plugin.settings.defaultImagePath)
					.onChange(async value => {
						this.plugin.settings.defaultImagePath = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl('h4', { text: 'Keyboard Shortcuts' });
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Click an initiative tracker to send these keys to it (it gets an outline). Clicking anywhere else turns them off.',
		});
		HOTKEY_ACTIONS.filter(({scope}) => scope === 'tracker')
			.forEach(({action, name, desc}) => this.addHotkeySetting(containerEl, action, name, desc));
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'In the stamina window, type a number in the Apply field and press one of these to apply it and close the window.',
		});
		HOTKEY_ACTIONS.filter(({scope}) => scope === 'stamina')
			.forEach(({action, name, desc}) => this.addHotkeySetting(containerEl, action, name, desc));
	}

	/** A shortcut setting: click the key to record a new one, or reset or clear it. */
	private addHotkeySetting(containerEl: HTMLElement, action: InitiativeHotkeyAction, name: string, desc: string): void {
		const scope = HOTKEY_ACTIONS.find((entry) => entry.action === action)?.scope;
		const setting = new Setting(containerEl).setName(name).setDesc(desc);
		const save = async (hotkey: string) => {
			this.plugin.settings.hotkeys = {...this.plugin.settings.hotkeys, [action]: hotkey};
			await this.plugin.saveSettings();
			this.display();
		};

		setting.addButton(button => {
			const hotkey = hotkeyFor(this.plugin.settings, action);
			button.setButtonText(hotkey || 'Not set')
				.setTooltip('Click, then press the new key (Escape cancels)')
				.onClick(() => {
					button.setButtonText('Press a key…').buttonEl.addClass('ds-hotkey-recording');
					const record = (e: KeyboardEvent) => {
						e.preventDefault();
						e.stopPropagation();
						if (e.key === 'Escape') {
							stop();
							this.display();
							return;
						}
						const pressed = hotkeyFromEvent(e);
						if (!pressed) return; // Wait for a key along with the modifiers
						stop();
						const taken = HOTKEY_ACTIONS.find((other) => other.action !== action && other.scope === scope
							&& hotkeyFor(this.plugin.settings, other.action) === pressed);
						if (taken) {
							new Notice(`${pressed} is already used by '${taken.name}'.`);
							this.display();
							return;
						}
						save(pressed);
					};
					const stop = () => window.removeEventListener('keydown', record, {capture: true});
					window.addEventListener('keydown', record, {capture: true});
					// Clicking elsewhere cancels the recording
					button.buttonEl.addEventListener('blur', () => {
						stop();
						button.setButtonText(hotkey || 'Not set').buttonEl.removeClass('ds-hotkey-recording');
					}, {once: true});
				});
		});
		setting.addExtraButton(button => button
			.setIcon('rotate-ccw')
			.setTooltip(`Reset to ${DEFAULT_HOTKEYS[action]}`)
			.onClick(() => save(DEFAULT_HOTKEYS[action])));
		setting.addExtraButton(button => button
			.setIcon('x')
			.setTooltip('Turn off')
			.onClick(() => save('')));
	}
}
