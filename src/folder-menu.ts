import { Menu, MenuItem, Notice, TFolder, normalizePath } from 'obsidian';
import type { AgentFile } from './agent-index';
import type FolderAgentPlugin from './main';
import { DEFAULT_AGENT_ICON } from './settings';

const MENU_TITLE = 'Folder Agent File';
const ADD_TITLE = 'Add…';

/**
 * Obsidian renders nested context menus, but `setSubmenu()` is not part of the
 * public API. It is reached through this narrow, feature detected adapter so
 * that everything else in the plugin stays on documented APIs; without it the
 * menu items are simply added to the parent menu instead. The call is guarded
 * because an undocumented API must never be able to drop the menu entry.
 */
interface SubmenuMenuItem extends MenuItem {
  setSubmenu?: () => Menu;
}

function openSubmenu(item: MenuItem): Menu | null {
  try {
    const submenu = (item as SubmenuMenuItem).setSubmenu?.call(item);
    return submenu instanceof Menu ? submenu : null;
  } catch (error) {
    console.error('[folder-agent] nested context menus unavailable', error);
    return null;
  }
}

/**
 * Adds the "Folder Agent File" entries to the context menu of folders.
 *
 * Obsidian has no separate event for folder menus: the file explorer fires the
 * documented `file-menu` event for folders as well, and the folder itself is
 * told apart with `instanceof TFolder`. The `source` argument is deliberately
 * ignored, because its values are undocumented and filtering on a guessed
 * string ('file-explorer') silently removed these entries on Obsidian 1.14.
 */
export function registerFolderContextMenu(plugin: FolderAgentPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFolder)) return;
      addFolderAgentMenu(plugin, menu, file);
    }),
  );
}

function addFolderAgentMenu(
  plugin: FolderAgentPlugin,
  menu: Menu,
  folder: TFolder,
): void {
  const { index } = plugin;
  if (index.configuredNames.length === 0) return;

  const files = index.list(folder.path);
  const missing = index.missingNames(folder.path);

  menu.addItem((item) => {
    item
      .setTitle(MENU_TITLE)
      .setIcon(files[0]?.settings.icon ?? DEFAULT_AGENT_ICON);
    const submenu = openSubmenu(item);
    if (!submenu) {
      // Obsidian build without submenu support: add everything flat.
      files.forEach((file) => addOpenItem(menu, plugin, file));
      missing.forEach((name) => addCreateItem(menu, plugin, folder, name));
      return;
    }

    files.forEach((file, position) =>
      addOpenItem(submenu, plugin, file, position === 0),
    );
    if (missing.length === 0) return;
    if (files.length > 0) submenu.addSeparator();
    addCreateSubmenu(submenu, plugin, folder, missing);
  });
}

function addOpenItem(
  menu: Menu,
  plugin: FolderAgentPlugin,
  agent: AgentFile,
  isActive = false,
): void {
  menu.addItem((item) => {
    item
      .setTitle(agent.settings.name)
      .setIcon(agent.settings.icon)
      .setChecked(isActive)
      .onClick(() => {
        void plugin.app.workspace.getLeaf(false).openFile(agent.file);
      });
  });
}

function addCreateSubmenu(
  menu: Menu,
  plugin: FolderAgentPlugin,
  folder: TFolder,
  names: string[],
): void {
  menu.addItem((item) => {
    item.setTitle(ADD_TITLE).setIcon('plus');
    const submenu = openSubmenu(item);
    if (!submenu) {
      names.forEach((name) => addCreateItem(menu, plugin, folder, name));
      return;
    }
    names.forEach((name) => addCreateItem(submenu, plugin, folder, name));
  });
}

function addCreateItem(
  menu: Menu,
  plugin: FolderAgentPlugin,
  folder: TFolder,
  name: string,
): void {
  menu.addItem((item) => {
    item.setTitle(name).setIcon('plus').onClick(() => {
      void createAgentFile(plugin, folder, name);
    });
  });
}

/** Creates an empty agent file in the folder and opens it. */
async function createAgentFile(
  plugin: FolderAgentPlugin,
  folder: TFolder,
  name: string,
): Promise<void> {
  const { vault, workspace } = plugin.app;
  const path = normalizePath(folder.path ? `${folder.path}/${name}` : name);

  if (vault.getAbstractFileByPath(path)) {
    new Notice(`${name} already exists in ${folder.path || '/'}`, 5000);
    return;
  }

  try {
    const file = await vault.create(path, '');
    await workspace.getLeaf(false).openFile(file);
  } catch (error) {
    new Notice(`Folder Agent could not create ${path}`);
    console.error('[folder-agent] could not create agent file', error);
  }
}