import {
	AbstractInputSuggest,
	PluginSettingTab,
	getIcon,
	getIconIds,
	setIcon,
} from 'obsidian';
import type { App, IconName, Setting, SettingDefinitionItem } from 'obsidian';
import type FolderAgentPlugin from './main';

/** Icon of a folder whose active agent file does not configure one. */
export const DEFAULT_AGENT_ICON = 'bot';

/** Colour shown by the picker for entries that were stored without a tint. */
const DEFAULT_TINT = '#8b949e';

/** Class of the agent file name field, styled in `styles.css`. */
const NAME_INPUT_CLASS = 'folder-agent-name-input';

/** Class of the icon name field, styled in `styles.css`. */
const ICON_INPUT_CLASS = 'folder-agent-icon-input';

/** Class of the list of configured agent file names. */
const LIST_CLASS = 'folder-agent-list';

/** Prefix Obsidian registers its Lucide icons under. */
const LUCIDE_PREFIX = 'lucide-';

/** One configured agent file name and how folders display it. */
export interface AgentFileSettings {
	/** Exact file name to look for, for example `AGENTS.md`. */
	name: string;
	/** Lucide icon id used by folders whose active agent file this is. */
	icon: string;
	/** CSS colour for the icon; empty inherits the theme's icon colour. */
	tint: string;
}

export interface FolderAgentSettings {
	/** Ordered list of agent file names; the first match wins in a folder. */
	agentFiles: AgentFileSettings[];
}

export const DEFAULT_SETTINGS: FolderAgentSettings = {
	agentFiles: [{ name: 'AGENTS.md', icon: DEFAULT_AGENT_ICON, tint: '' }],
};

/** Returns an error message for an unusable file name, or `null` if it is fine. */
export function validateAgentName(
	name: string,
	others: AgentFileSettings[] = [],
): string | null {
	const trimmed = name.trim();
	if (!trimmed) return 'Enter a file name.';
	if (trimmed === '.' || trimmed === '..') return `"${trimmed}" is not a file name.`;
	if (/[\\/]/.test(trimmed)) return 'File names cannot contain "/" or "\\".';
	const taken = others.some(
		(entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (taken) return `"${trimmed}" is already in the list.`;
	return null;
}

/** Keeps a tint only when it is empty or a colour the browser understands. */
function normalizeTint(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return '';
	return CSS.supports('color', trimmed) ? trimmed : '';
}

/** Turns stored data into settings, dropping entries that are unusable. */
export function normalizeSettings(data: unknown): FolderAgentSettings {
	if (data === null || typeof data !== 'object') {
		return {
			agentFiles: DEFAULT_SETTINGS.agentFiles.map((entry) => ({ ...entry })),
		};
	}

	const stored = (data as { agentFiles?: unknown }).agentFiles;
	if (!Array.isArray(stored)) return { agentFiles: [] };

	const agentFiles: AgentFileSettings[] = [];
	for (const item of stored) {
		const entry = item as Partial<AgentFileSettings> | null;
		const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
		if (validateAgentName(name, agentFiles)) continue;
		agentFiles.push({
			name,
			icon:
				typeof entry?.icon === 'string' && entry.icon.trim()
					? entry.icon.trim()
					: DEFAULT_AGENT_ICON,
			tint:
				typeof entry?.tint === 'string' ? normalizeTint(entry.tint) : '',
		});
	}
	return { agentFiles };
}

/** Settings tab with the ordered list of agent file names. */
export class FolderAgentSettingTab extends PluginSettingTab {
	override icon: IconName = DEFAULT_AGENT_ICON;

	constructor(
		app: App,
		private readonly plugin: FolderAgentPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const agentFiles = this.plugin.settings.agentFiles;
		return [
			{
				type: 'list',
				cls: LIST_CLASS,
				heading: 'Agent file names',
				desc:
					'Files with these names are hidden in the file explorer, and folders that contain one get an icon that opens the active file. ' +
					'The first file that exists in a folder is its active agent file; drag an entry to change that priority.',
				emptyState:
					'No agent file names configured, so no files are hidden.',
				addItem: {
					name: 'Add file name',
					action: () => void this.addEntry(),
				},
				onReorder: (from, to) => void this.moveEntry(from, to),
				onDelete: (index) => void this.removeEntry(index),
				items: agentFiles.map((entry, index) => ({
					name: entry.name,
					render: (setting: Setting) => this.renderEntry(setting, entry, index),
				})),
			},
		];
	}

	/** Renders the name, icon and colour controls of one agent file name. */
	private renderEntry(
		setting: Setting,
		entry: AgentFileSettings,
		index: number,
	): () => void {
		setting.setClass('folder-agent-entry');

		// Created up front so the change handlers below can update it, then
		// moved after the appearance controls, before the row actions.
		const previewEl = setting.controlEl.createSpan({ cls: 'folder-agent-preview' });
		const updatePreview = (): void => {
			previewEl.empty();
			setIcon(previewEl, getIcon(entry.icon) ? entry.icon : DEFAULT_AGENT_ICON);
			if (entry.tint) previewEl.style.color = entry.tint;
		};
		updatePreview();

		let iconInput: HTMLInputElement | undefined;
		let suggest: IconNameSuggest | undefined;
		const commitIcon = (value: string): void => {
			entry.icon = value.trim() || DEFAULT_AGENT_ICON;
			if (iconInput) markIconInput(iconInput, entry);
			updatePreview();
			void this.plugin.saveAppearance();
		};

		setting
			.addText((text) => {
				text.inputEl.addClass(NAME_INPUT_CLASS);
				return text
					.setValue(entry.name)
					.setPlaceholder('AGENTS.md')
					.onChange((value) => {
						const others = this.plugin.settings.agentFiles.filter(
							(_, other) => other !== index,
						);
						const error = validateAgentName(value, others);
						setting.setErrorMessage(error);
						if (error) return;
						entry.name = value.trim();
						void this.plugin.saveSettings();
					});
			})
			.addText((text) => {
				text.inputEl.addClass(ICON_INPUT_CLASS);
				iconInput = text.inputEl;
				markIconInput(iconInput, entry);
				suggest = new IconNameSuggest(this.app, iconInput, commitIcon);
				return text
					.setValue(entry.icon)
					.setPlaceholder(DEFAULT_AGENT_ICON)
					.onChange(commitIcon);
			})
			.addColorPicker((color) =>
				color
					.setValue(entry.tint || DEFAULT_TINT)
					.onChange((value) => {
						entry.tint = value.trim();
						updatePreview();
						void this.plugin.saveAppearance();
					}),
			);

		setting.controlEl.append(previewEl);

		// The suggestion popover lives outside the row, so it has to be closed.
		return () => suggest?.close();
	}

	private async addEntry(): Promise<void> {
		this.plugin.settings.agentFiles.push({
			name: suggestName(this.plugin.settings.agentFiles),
			icon: DEFAULT_AGENT_ICON,
			tint: '',
		});
		await this.plugin.saveSettings();
		this.update();
	}

	private async moveEntry(from: number, to: number): Promise<void> {
		const agentFiles = this.plugin.settings.agentFiles;
		const [entry] = agentFiles.splice(from, 1);
		if (!entry) return;
		agentFiles.splice(to, 0, entry);
		await this.plugin.saveSettings();
		this.update();
	}

	private async removeEntry(index: number): Promise<void> {
		this.plugin.settings.agentFiles.splice(index, 1);
		await this.plugin.saveSettings();
		this.update();
	}
}

/** Whether Obsidian resolves a bare Lucide name such as `bot`; cached. */
let bareLucideNames: boolean | null = null;

function prefersBareLucideNames(): boolean {
	if (bareLucideNames !== null) return bareLucideNames;
	const registered = getIconIds().find((id) => id.startsWith(LUCIDE_PREFIX));
	bareLucideNames = registered
		? getIcon(registered.slice(LUCIDE_PREFIX.length)) !== null
		: false;
	return bareLucideNames;
}

/**
 * The icons Obsidian lists in its registry are the Lucide ones under their
 * internal `lucide-` ids, while the documented icon API is used with the bare
 * name. Suggestions and stored values use the bare name, but only after
 * Obsidian itself confirms that it resolves it.
 */
function canonicalIconName(registered: IconName): IconName {
	if (!prefersBareLucideNames() || !registered.startsWith(LUCIDE_PREFIX)) {
		return registered;
	}
	return registered.slice(LUCIDE_PREFIX.length);
}

/**
 * Autocomplete for the icon field, backed by the icons Obsidian has
 * registered, so no icon list is hardcoded here.
 */
class IconNameSuggest extends AbstractInputSuggest<IconName> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly onPick: (icon: string) => void,
	) {
		super(app, inputEl);
	}

	protected override getSuggestions(query: string): IconName[] {
		const needle = query.trim().toLowerCase();
		if (!needle) return [];

		const matching: IconName[] = [];
		const containing: IconName[] = [];
		const seen = new Set<IconName>();
		for (const id of getIconIds()) {
			const icon = canonicalIconName(id);
			if (seen.has(icon)) continue;
			seen.add(icon);

			const name = icon.toLowerCase();
			if (name.startsWith(needle)) matching.push(icon);
			else if (name.includes(needle)) containing.push(icon);
		}
		matching.sort();
		containing.sort();
		return [...matching, ...containing];
	}

	override renderSuggestion(icon: IconName, el: HTMLElement): void {
		const option = el.createDiv({ cls: 'folder-agent-icon-option' });
		setIcon(option, icon);
		option.createSpan({ text: icon });
	}

	override selectSuggestion(icon: IconName): void {
		this.setValue(icon);
		this.close();
		this.onPick(icon);
	}
}

/** Flags the icon field when its value is not an icon Obsidian knows. */
function markIconInput(
	inputEl: HTMLInputElement,
	entry: AgentFileSettings,
): void {
	const invalid = !getIcon(entry.icon);
	inputEl.toggleClass('is-invalid', invalid);
	inputEl.title = invalid
		? `"${entry.icon}" is not an icon Obsidian knows`
		: '';
}

/**
 * Suggests a file name that is not in the list yet: `AGENTS.md`, `AGENTS-2.md`,
 * … The loop is bounded by the list size, so one candidate is always free.
 */
function suggestName(entries: AgentFileSettings[]): string {
	const taken = new Set(entries.map((entry) => entry.name.toLowerCase()));
	for (let index = 1; index <= taken.size + 1; index++) {
		const candidate = index === 1 ? 'AGENTS.md' : `AGENTS-${index}.md`;
		if (!taken.has(candidate.toLowerCase())) return candidate;
	}
	return 'AGENTS.md';
}