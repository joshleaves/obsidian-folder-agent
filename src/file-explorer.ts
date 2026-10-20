import { Component, getIcon, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { AgentFile, AgentFileIndex } from './agent-index';
import { DEFAULT_AGENT_ICON } from './settings';

/** Class of the icon Folder Agent adds to a folder row. */
const BADGE_CLASS = 'folder-agent-badge';
/** Class of the agent files that are hidden from the file explorer. */
const HIDDEN_CLASS = 'folder-agent-hidden';
/** Row element of a folder in the file explorer. */
const FOLDER_TITLE_SELECTOR = '.nav-folder-title';
/** Row element of a file in the file explorer. */
const FILE_TITLE_SELECTOR = '.nav-file-title';
/** Attribute that carries the vault path of a row. */
const PATH_ATTRIBUTE = 'data-path';

/**
 * Hides agent files in the file explorer and marks their folders with an icon.
 *
 * Obsidian has no public API for either, so this adapter is the only place in
 * the plugin that touches the file explorer. It keeps that DOM integration as
 * small as possible and relies on two long standing conventions of the
 * explorer markup: every row carries its vault path in a `data-path`
 * attribute, and rows are recreated whenever the tree changes.
 *
 * One mutation observer per file explorer therefore keeps both parts in sync:
 * agent files get {@link HIDDEN_CLASS} (the rule lives in `styles.css`) and
 * folders with an agent file get a badge. Clicks on a badge are handled by one
 * delegated listener per explorer.
 *
 * Everything created here (badges, classes, observers, listeners) is released
 * again in `onunload()`, which restores the untouched file explorer.
 */
export class FileExplorerIntegration extends Component {
  private readonly explorers = new Map<HTMLElement, MutationObserver>();
  private hidden = new Set<string>();
  private frame = 0;

  constructor(
    private readonly app: App,
    private readonly index: AgentFileIndex,
  ) {
    super();
  }

  override onload(): void {
    this.watchExplorers();
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.watchExplorers()),
    );
    this.refresh();
  }

  override onunload(): void {
    window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const [container, observer] of this.explorers) {
      observer.disconnect();
      clearExplorer(container);
    }
    this.explorers.clear();
    this.hidden = new Set();
  }

  /** Re-applies the current index to the file explorer. */
  refresh(): void {
    this.hidden = new Set(this.index.paths());
    this.scheduleSync();
  }

  /** Attaches an observer to every file explorer of the workspace. */
  private watchExplorers(): void {
    const containers = this.app.workspace
      .getLeavesOfType('file-explorer')
      .map((leaf) => leaf.view.containerEl);
    const current = new Set(containers);

    for (const [container, observer] of this.explorers) {
      if (current.has(container)) continue;
      observer.disconnect();
      clearExplorer(container);
      this.explorers.delete(container);
    }

    for (const container of containers) {
      if (this.explorers.has(container)) continue;
      const observer = new MutationObserver(() => this.scheduleSync());
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributeFilter: [PATH_ATTRIBUTE],
        attributes: true,
      });
      this.explorers.set(container, observer);
      // Capture phase, so a badge click is handled before the folder row
      // receives it and toggles the folder.
      this.registerDomEvent(
        container,
        'click',
        (event) => this.openBadgeTarget(event),
        { capture: true },
      );
    }

    this.scheduleSync();
  }

  /** Coalesces explorer mutations into one synchronisation per frame. */
  private scheduleSync(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }

  /** Hides agent files and adds or removes one badge per folder row. */
  private sync(): void {
    for (const container of this.explorers.keys()) {
      for (const row of container.querySelectorAll<HTMLElement>(
        FILE_TITLE_SELECTOR,
      )) {
        const path = row.getAttribute(PATH_ATTRIBUTE);
        row.classList.toggle(
          HIDDEN_CLASS,
          path !== null && this.hidden.has(path),
        );
      }

      for (const row of container.querySelectorAll<HTMLElement>(
        FOLDER_TITLE_SELECTOR,
      )) {
        const folderPath = row.getAttribute(PATH_ATTRIBUTE);
        if (!folderPath) continue;

        const badge = row.querySelector<HTMLElement>(`:scope > .${BADGE_CLASS}`);
        const active = this.index.getActive(folderPath);
        if (!active) {
          badge?.remove();
        } else if (badge) {
          this.updateBadge(badge, active);
        } else {
          this.createBadge(row, active);
        }
      }
    }
  }

  /** Appends the folder icon to a folder row. */
  private createBadge(row: HTMLElement, active: AgentFile): void {
    const badge = row.createSpan({
      cls: BADGE_CLASS,
      attr: { role: 'button', tabindex: '-1', draggable: 'false' },
    });
    this.updateBadge(badge, active);
  }

  private updateBadge(badge: HTMLElement, active: AgentFile): void {
    const { icon, tint, name } = active.settings;
    // The explorer re-renders while scrolling and expanding, so a badge is
    // only touched when its active file or its appearance differs.
    const signature = `${icon} ${tint} ${active.file.path}`;
    if (badge.dataset['signature'] === signature) return;
    badge.dataset['signature'] = signature;

    badge.empty();
    setIcon(badge, getIcon(icon) ? icon : DEFAULT_AGENT_ICON);
    if (tint) badge.style.color = tint;
    else badge.style.removeProperty('color');
    badge.setAttribute('aria-label', `Open ${name}`);
    badge.title = `Open ${name}`;
  }

  /** Opens the active agent file of the folder whose badge was clicked. */
  private openBadgeTarget(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const badge = target.closest(`.${BADGE_CLASS}`);
    if (!badge) return;

    const folderPath = badge
      .closest<HTMLElement>(FOLDER_TITLE_SELECTOR)
      ?.getAttribute(PATH_ATTRIBUTE);
    const active = folderPath ? this.index.getActive(folderPath) : null;
    if (!active) return;

    // The folder row is an ancestor of the badge and toggles on click.
    event.preventDefault();
    event.stopPropagation();
    void this.app.workspace.getLeaf(false).openFile(active.file);
  }
}

/** Removes everything Folder Agent added to a file explorer. */
function clearExplorer(container: HTMLElement): void {
  for (const badge of container.querySelectorAll(`.${BADGE_CLASS}`)) {
    badge.remove();
  }
  for (const row of container.querySelectorAll(`.${HIDDEN_CLASS}`)) {
    row.classList.remove(HIDDEN_CLASS);
  }
}