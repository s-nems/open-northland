// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mapItem } from '../../../../src/entries/main-menu/map-select/model.js';
import { type CreateChoice, createRoomCard } from '../../../../src/entries/main-menu/network/create-card.js';
import { TINY_FINGERPRINT } from '../../../support/catalog-maps.js';

afterEach(() => {
  document.body.replaceChildren();
});

it('locks the room with the trimmed password and leaves a blank one out', async () => {
  const create = vi.fn(async (_choice: CreateChoice) => undefined);
  const card = createRoomCard({ create, pickMap: vi.fn() });
  document.body.append(card.element);
  card.setMap(mapItem({ id: 'forest', fingerprint: TINY_FINGERPRINT, picture: false, minimap: false }));
  const password = card.element.querySelector<HTMLInputElement>('input[type="password"]');
  if (password === null) throw new Error('no password field');
  // A saved login filled in here would lock the room unseen.
  expect(password.autocomplete).toBe('new-password');
  const submit = async (typed: string): Promise<CreateChoice | undefined> => {
    password.value = typed;
    create.mockClear();
    card.element.requestSubmit();
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    return create.mock.calls[0]?.[0];
  };
  expect(await submit('  sekret ')).toMatchObject({ kind: 'map', mapId: 'forest', password: 'sekret' });
  const open = await submit('   ');
  expect(open).toMatchObject({ kind: 'map', mapId: 'forest' });
  expect(open).not.toHaveProperty('password');
  card.dispose();
});
