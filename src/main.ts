import { Plugin, TFile } from 'obsidian';
import type { App, PluginManifest, TAbstractFile } from 'obsidian';
import { AgentFileIndex } from './agent-index';
import { FileExplorerIntegration } from './file-explorer';
import { registerFolderContextMenu } from './folder-menu';
import {
	FolderAgentSettingTab,
	normalizeSettings,
} from './settings';
import type { FolderAgentSettings } from './settings';

export default class FolderAgentPlugin extends Plugin {
	override settings: FolderAgentSettings = { agentFiles: [] };

	/** Index of the agent files that currently exist in the vault. */
	readonly index: AgentFileIndex;

	private explorer!: FileExplorerIntegration;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.index = new AgentFileIndex(app.vault);
	}

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.index.update(this.settings.agentFiles);
		this.explorer = this.addChild(
			new FileExplorerIntegration(this.app, this.index),
		);
		this.registerVaultEvents();
		registerFolderContextMenu(this);
		this.addSettingTab(new FolderAgentSettingTab(this.app, this));
	}

	override onunload(): void {
		// Children are unloaded with the plugin; doing it here as well makes
		// sure the file explorer is restored however the app disables us.
		this.explorer?.unload();
	}

	/** Stores the settings and applies them to the vault and file explorer. */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.index.update(this.settings.agentFiles);
		this.explorer.refresh();
	}

	/**
	 * Stores the settings and refreshes what depends on appearance only, which
	 * is enough for icon and colour changes and avoids a vault rescan.
	 */
	async saveAppearance(): Promise<void> {
		await this.saveData(this.settings);
		this.explorer.refresh();
	}

	private async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	private registerVaultEvents(): void {
		const { vault } = this.app;
		const applyIfChanged = (update: () => boolean): void => {
			if (update()) this.explorer.refresh();
		};

		this.registerEvent(
			vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile) applyIfChanged(() => this.index.add(file));
			}),
		);
		this.registerEvent(
			vault.on('delete', (file: TAbstractFile) => {
				if (file instanceof TFile) applyIfChanged(() => this.index.remove(file));
			}),
		);
		this.registerEvent(
			vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile) {
					applyIfChanged(() => this.index.rename(file, oldPath));
				}
			}),
		);
	}
}