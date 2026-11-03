// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { modsScreen } from '../../../../src/entries/main-menu/mods/screen.js';
import { messages } from '../../../../src/i18n/index.js';

/** The Mods screen stores every change at once and leaves the reload to the shell's teardown, so one
 *  visit can install, enable and remove several packs. The store and archive reader are faked; the
 *  pending flag and the teardown reload are the contract under test. */

const fake = vi.hoisted(() => ({
  mods: [] as { id: string; name: string; enabled: boolean; size: number }[],
  listContentMods: vi.fn<() => Promise<unknown>>(),
  installContentMod: vi.fn<(...args: unknown[]) => Promise<void>>(),
  setContentModEnabled: vi.fn<(...args: unknown[]) => Promise<void>>(),
  removeContentMod: vi.fn<(...args: unknown[]) => Promise<void>>(),
  readContentMod: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('../../../../src/content/mods/store.js', () => fake);
vi.mock('../../../../src/content/mods/archive.js', () => ({ readContentMod: fake.readContentMod }));

const PACKS = [
  { id: 'aaa', name: 'Ania pack', enabled: true, size: 1_048_576 },
  { id: 'bbb', name: 'Bartek pack', enabled: false, size: 2_097_152 },
];

beforeEach(() => {
  fake.mods = PACKS.map((pack) => ({ ...pack }));
  fake.listContentMods.mockImplementation(async () => fake.mods);
  fake.setContentModEnabled.mockImplementation(async (id: unknown, enabled: unknown) => {
    fake.mods = fake.mods.map((mod) => (mod.id === id ? { ...mod, enabled: Boolean(enabled) } : mod));
  });
  fake.removeContentMod.mockImplementation(async (id: unknown) => {
    fake.mods = fake.mods.filter((mod) => mod.id !== id);
  });
  fake.installContentMod.mockImplementation(async (mod: unknown) => {
    const pack = mod as { id: string; name: string; size: number };
    fake.mods = [...fake.mods, { id: pack.id, name: pack.name, enabled: true, size: pack.size }];
  });
  fake.readContentMod.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
});

function mount() {
  const reload = vi.fn();
  const open = vi.fn();
  const screen = modsScreen(open, reload);
  document.body.append(screen.element);
  const rows = (): HTMLElement[] => [...screen.element.querySelectorAll<HTMLElement>('.mods__row')];
  const status = (): string => screen.element.querySelector<HTMLElement>('.mods__status')?.textContent ?? '';
  const back = screen.element.querySelector<HTMLButtonElement>('.main-menu__back');
  const dropZone = screen.element.querySelector<HTMLElement>('.mods__drop');
  if (back === null || dropZone === null || screen.dispose === undefined)
    throw new Error('mods screen is missing its parts');
  const dropFile = (name: string): void =>
    void dropZone.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: { files: [new File(['zip'], name)] },
      }),
    );
  return { open, reload, dispose: screen.dispose, rows, status, back, dropFile };
}

it('stores a toggle in place and hands the reload to the teardown on the way out', async () => {
  const h = mount();
  await vi.waitFor(() => expect(h.rows()).toHaveLength(2));
  const checkbox = h.rows()[0]?.querySelector<HTMLInputElement>('input');
  if (checkbox === null || checkbox === undefined) throw new Error('no toggle');
  checkbox.click();
  await vi.waitFor(() => expect(fake.setContentModEnabled).toHaveBeenCalledExactlyOnceWith('aaa', false));
  expect(h.reload).not.toHaveBeenCalled();
  expect(h.status()).toBe(messages().mainMenu.mods.pending);
  checkbox.click();
  await vi.waitFor(() => expect(fake.setContentModEnabled).toHaveBeenCalledTimes(2));
  expect(h.reload).not.toHaveBeenCalled();
  h.dispose();
  expect(h.reload).toHaveBeenCalledOnce();
});

it('keeps the checkbox and the clean leave when the store refuses a toggle', async () => {
  fake.setContentModEnabled.mockRejectedValueOnce(new Error('storage full'));
  const h = mount();
  await vi.waitFor(() => expect(h.rows()).toHaveLength(2));
  const checkbox = h.rows()[1]?.querySelector<HTMLInputElement>('input');
  if (checkbox === null || checkbox === undefined) throw new Error('no toggle');
  checkbox.click();
  await vi.waitFor(() => expect(h.status()).toContain('storage full'));
  expect(checkbox.checked).toBe(false);
  h.dispose();
  expect(h.reload).not.toHaveBeenCalled();
});

it('drops a pack from the list in place and hands the reload to the teardown', async () => {
  const h = mount();
  await vi.waitFor(() => expect(h.rows()).toHaveLength(2));
  const remove = h.rows()[0]?.querySelector<HTMLButtonElement>('.mods__remove');
  remove?.click();
  await vi.waitFor(() => expect(fake.removeContentMod).toHaveBeenCalledExactlyOnceWith('aaa'));
  await vi.waitFor(() => expect(h.rows()).toHaveLength(1));
  expect(h.reload).not.toHaveBeenCalled();
  expect(h.status()).toBe(messages().mainMenu.mods.pending);
  h.dispose();
  expect(h.reload).toHaveBeenCalledOnce();
});

it('installs a dropped pack in place and hands the reload to the teardown', async () => {
  fake.readContentMod.mockResolvedValue({ id: 'ccc', name: 'Celine pack', size: 3, files: [] });
  const h = mount();
  await vi.waitFor(() => expect(h.rows()).toHaveLength(2));
  h.dropFile('celine.zip');
  await vi.waitFor(() =>
    expect(fake.installContentMod).toHaveBeenCalledExactlyOnceWith({
      id: 'ccc',
      name: 'Celine pack',
      size: 3,
      files: [],
    }),
  );
  await vi.waitFor(() => expect(h.rows()).toHaveLength(3));
  expect(h.reload).not.toHaveBeenCalled();
  expect(h.status()).toBe(messages().mainMenu.mods.pending);
  h.dispose();
  expect(h.reload).toHaveBeenCalledOnce();
});

it('lets the shell own the leaving: the back link only asks it to navigate', async () => {
  const h = mount();
  await vi.waitFor(() => expect(h.rows()).toHaveLength(2));
  h.back.click();
  expect(h.open).toHaveBeenCalledExactlyOnceWith('main');
  expect(h.reload).not.toHaveBeenCalled();
  h.dispose();
  expect(h.reload).not.toHaveBeenCalled();
});

it('leaves without a reload when the visit changed nothing', () => {
  const h = mount();
  h.dispose();
  expect(h.reload).not.toHaveBeenCalled();
});
