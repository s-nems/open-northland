import { readContentMod } from '../../../content/mods/archive.js';
import {
  installContentMod,
  listContentMods,
  removeContentMod,
  setContentModEnabled,
} from '../../../content/mods/store.js';
import { messages } from '../../../i18n/index.js';
import { node } from '../dom.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every change is stored at once, but the menu holds the content it already loaded; the reload the
 *  screen's teardown asks for when the player leaves swaps it in. That keeps one visit free to
 *  install, enable and remove several packs without a reload between the steps. */
export function modsScreen(
  open: (screen: MenuScreen) => void,
  reload: () => void = (): void => window.location.reload(),
): MountedScreen {
  const copy = messages().mainMenu;
  const section = node('section', 'main-menu__screen main-menu__mods');
  const head = screenHead('mods', open);
  const content = node('div', 'mods__content');
  const actions = node('div', 'mods__actions');
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.zip,application/zip';
  picker.hidden = true;
  const importButton = node('button', 'main-menu__primary', copy.mods.importButton);
  importButton.type = 'button';
  importButton.addEventListener('click', () => picker.click());
  actions.append(importButton, picker);

  const drop = node('div', 'mods__drop', copy.mods.drop);
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) void importFile(file);
  });

  const status = node('p', 'mods__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = node('div', 'mods__list');
  let pending = false;
  const changed = (): void => {
    pending = true;
    status.textContent = copy.mods.pending;
  };

  async function renderList(): Promise<void> {
    try {
      const mods = await listContentMods();
      list.replaceChildren();
      if (mods.length === 0) list.append(node('p', 'mods__empty', copy.mods.empty));
      for (const mod of mods) {
        const row = node('article', 'mods__row');
        const toggle = node('label', 'mods__toggle');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = mod.enabled;
        checkbox.addEventListener('change', () => {
          void setContentModEnabled(mod.id, checkbox.checked)
            .then(changed)
            .catch((error: unknown) => {
              checkbox.checked = mod.enabled;
              status.textContent = copy.mods.failed.replace('{error}', detail(error));
            });
        });
        toggle.append(checkbox, node('span', '', mod.name));
        const meta = node('span', 'mods__meta', `${(mod.size / (1024 * 1024)).toFixed(1)} MB`);
        const remove = node('button', 'main-menu__ghost mods__remove', copy.mods.remove);
        remove.type = 'button';
        remove.addEventListener('click', () => {
          void removeContentMod(mod.id)
            .then(() => {
              void renderList();
              changed();
            })
            .catch((error: unknown) => {
              status.textContent = copy.mods.failed.replace('{error}', detail(error));
            });
        });
        row.append(toggle, meta, remove);
        list.append(row);
      }
    } catch (error) {
      status.textContent = copy.mods.failed.replace('{error}', detail(error));
    }
  }

  async function importFile(file: File): Promise<void> {
    status.textContent = copy.mods.loading;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error('ZIP archive exceeds the 64 MiB limit');
      const archive = new Uint8Array(await file.arrayBuffer());
      await installContentMod(await readContentMod(file.name, archive));
      await renderList();
      changed();
    } catch (error) {
      status.textContent = copy.mods.failed.replace('{error}', detail(error));
    }
  }

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.value = '';
    if (file !== undefined) void importFile(file);
  });

  content.append(actions, drop, status, list);
  section.append(head, content);
  void renderList();
  return {
    element: section,
    dispose: (): void => {
      if (pending) reload();
    },
  };
}
