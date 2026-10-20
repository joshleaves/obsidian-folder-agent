import type { TFile, Vault } from 'obsidian';
import type { AgentFileSettings } from './settings';

/** An agent file that exists in the vault, together with its configured entry. */
export interface AgentFile {
  /** The file as it exists on disk. */
  file: TFile;
  /** The configuration entry that matched this file. */
  settings: AgentFileSettings;
}

interface FolderAgentFiles {
  /** Agent files of this folder, keyed by file name. */
  byName: Map<string, AgentFile>;
  /** The agent file with the highest configured priority, if any. */
  active: AgentFile | null;
}

/**
 * Index of the agent files that currently exist in the vault.
 *
 * The vault is the single source of truth: the index is rebuilt from the file
 * system when the plugin loads or the configuration changes, and afterwards
 * kept up to date with vault create/delete/rename events. Nothing about it is
 * persisted.
 */
export class AgentFileIndex {
  private configured: AgentFileSettings[] = [];
  private configuredByName = new Map<string, AgentFileSettings>();
  private priority = new Map<AgentFileSettings, number>();
  private folders = new Map<string, FolderAgentFiles>();

  constructor(private readonly vault: Vault) {}

  /** Configured file names, in priority order. */
  get configuredNames(): string[] {
    return this.configured.map((entry) => entry.name);
  }

  /** Applies a new configuration and rescans the vault. */
  update(settings: AgentFileSettings[]): void {
    this.configured = settings;
    this.configuredByName = new Map(settings.map((entry) => [entry.name, entry]));
    this.priority = new Map(settings.map((entry, index) => [entry, index]));
    this.folders = new Map();
    for (const file of this.vault.getFiles()) this.track(file);
  }

  /** The active agent file of a folder, or `null` if the folder has none. */
  getActive(folderPath: string): AgentFile | null {
    return this.folders.get(folderPath)?.active ?? null;
  }

  /** The agent files of a folder, ordered by configured priority. */
  list(folderPath: string): AgentFile[] {
    const folder = this.folders.get(folderPath);
    if (!folder) return [];
    return [...folder.byName.values()].sort(
      (a, b) => this.priorityOf(a) - this.priorityOf(b),
    );
  }

  /** Configured file names that do not exist in the folder yet. */
  missingNames(folderPath: string): string[] {
    const folder = this.folders.get(folderPath);
    return this.configured
      .filter((entry) => !folder?.byName.has(entry.name))
      .map((entry) => entry.name);
  }

  /** Paths of all agent files in the vault, to hide them in the file explorer. */
  paths(): string[] {
    const paths: string[] = [];
    for (const folder of this.folders.values()) {
      for (const agent of folder.byName.values()) paths.push(agent.file.path);
    }
    return paths;
  }

  /** Tracks a newly created file. Returns `true` if the index changed. */
  add(file: TFile): boolean {
    return this.track(file);
  }

  /** Untracks a deleted file. Returns `true` if the index changed. */
  remove(file: TFile): boolean {
    return this.untrack(file.path);
  }

  /** Tracks a renamed file. Returns `true` if the index changed. */
  rename(file: TFile, oldPath: string): boolean {
    const removed = this.untrack(oldPath);
    return this.track(file) || removed;
  }

  private track(file: TFile): boolean {
    const settings = this.configuredByName.get(file.name);
    const folderPath = file.parent?.path;
    if (!settings || folderPath === undefined) return false;

    let folder = this.folders.get(folderPath);
    if (!folder) {
      folder = { byName: new Map(), active: null };
      this.folders.set(folderPath, folder);
    }

    const tracked = folder.byName.get(file.name);
    if (tracked?.file === file) return false;

    folder.byName.set(file.name, { file, settings });
    this.updateActive(folder);
    return true;
  }

  private untrack(path: string): boolean {
    const separator = path.lastIndexOf('/');
    const folderPath = separator === -1 ? '' : path.slice(0, separator);
    const folder = this.folders.get(folderPath);
    if (!folder?.byName.delete(path.slice(separator + 1))) return false;

    this.updateActive(folder);
    if (folder.byName.size === 0) this.folders.delete(folderPath);
    return true;
  }

  private updateActive(folder: FolderAgentFiles): void {
    let active: AgentFile | null = null;
    let activePriority = Number.POSITIVE_INFINITY;
    for (const agent of folder.byName.values()) {
      const priority = this.priorityOf(agent);
      if (priority < activePriority) {
        active = agent;
        activePriority = priority;
      }
    }
    folder.active = active;
  }

  private priorityOf(agent: AgentFile): number {
    return this.priority.get(agent.settings) ?? Number.POSITIVE_INFINITY;
  }
}