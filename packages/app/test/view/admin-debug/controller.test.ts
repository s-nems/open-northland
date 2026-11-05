// @vitest-environment jsdom
import type { Command } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_ARCHER_LONG, JOB_CIVILIST, JOB_SOLDIER_SWORD } from '../../../src/catalog/jobs.js';
import { messages } from '../../../src/i18n/index.js';
import { HOLD_REPEAT_DELAY_MS, HOLD_REPEAT_INTERVAL_MS } from '../../../src/view/admin-debug/hold-repeat.js';
import { mountAdminDebug } from '../../../src/view/admin-debug/index.js';

const copy = messages().admin;
const goods = messages().goods;
const TILE = { col: 12, row: 34 };
const PICKED = 42;
const SEAT_TRIBE = 3;
const LONG_BOW_GOOD = 38;
const CHAIN = { armorClass: 3, good: 35, id: 'armor_chain' };
const LEARNED: readonly (readonly [number, number])[] = [[7, 500]];
const HALL = { typeId: 1, label: 'Hala' };

afterEach(() => {
  document.body.replaceChildren();
});

function mount() {
  const canvas = document.createElement('canvas');
  const plane = document.createElement('div');
  document.body.append(canvas, plane);
  const sent: Command[] = [];
  const enterStanding = vi.fn(() => true);
  const cancelPlacement = vi.fn();
  const handle = mountAdminDebug({
    canvas,
    plane,
    enqueue: (command) => sent.push(command),
    clientToTile: () => TILE,
    pickEntity: () => PICKED,
    claimPointer: () => false,
    seatTribeOf: () => SEAT_TRIBE,
    enterStanding,
    cancelPlacement,
    buildings: [HALL],
    goods: [{ good: LONG_BOW_GOOD, id: 'bow_long' }],
    armors: [CHAIN],
    learnedExperience: LEARNED,
    geometryEnabled: () => false,
    setGeometryEnabled: () => undefined,
    zoomOutUnlocked: () => false,
    setZoomOutUnlocked: () => undefined,
  });
  plane.append(handle.toggle);
  const tile = (label: string): HTMLButtonElement => {
    const found = [...plane.querySelectorAll<HTMLButtonElement>('.on-admin__tile')].find((b) =>
      b.textContent?.startsWith(label),
    );
    if (found === undefined) throw new Error(`missing tile ${label}`);
    return found;
  };
  const press = (target: EventTarget, button = 0): MouseEvent => {
    const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
    return down;
  };
  const footer = (): string => plane.querySelector('.on-admin__status-text b')?.textContent ?? '';
  const option = (knob: string, label: string): HTMLButtonElement => {
    const strip = plane.querySelector(`.on-admin__choices[aria-label="${knob}"]`);
    const found = [...(strip?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (b) => b.getAttribute('aria-label') === label,
    );
    if (found === undefined) throw new Error(`missing ${knob} option ${label}`);
    return found;
  };
  return { canvas, plane, sent, enterStanding, cancelPlacement, handle, tile, press, footer, option };
}

describe('debug tools controller', () => {
  it('drops the armed unit where the map is clicked, and a second press on its tile puts it away', () => {
    const { handle, tile, press, canvas, sent } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    expect(canvas.style.cursor).not.toBe('');
    press(canvas);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'spawnSettler', x: TILE.col, y: TILE.row, tribe: SEAT_TRIBE });

    tile(copy.soldier).click();
    press(canvas);
    expect(sent).toHaveLength(1);
    expect(canvas.style.cursor).toBe('');
  });

  it('never spawns from a press on the panel itself', () => {
    const { handle, tile, press, plane, sent } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    press(plane.querySelector('.on-admin__body') as HTMLElement);
    expect(sent).toEqual([]);
  });

  it('puts the tool away on a right click, on Esc and when the panel closes', () => {
    const { handle, tile, press, canvas, footer } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    const right = press(canvas, 2);
    expect(right.defaultPrevented).toBe(true);
    expect(footer()).toBe(copy.idle);

    tile(copy.soldier).click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(footer()).toBe(copy.idle);

    tile(copy.soldier).click();
    handle.toggle.click();
    expect(footer()).toBe(copy.idle);
  });

  it('renames the armed spawn when its owner changes', () => {
    const { handle, tile, plane, footer } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    const before = footer();
    plane.querySelectorAll<HTMLButtonElement>('.on-admin__swatch')[1]?.click();
    expect(footer()).not.toBe(before);
    expect(footer()).toContain(messages().animation.playerColors[1]);
  });

  it('arms a soldier with the picked weapon and armor, both in its equipment', () => {
    const { handle, tile, press, canvas, sent, option } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    press(canvas);
    expect(sent[0]).toMatchObject({ jobType: JOB_SOLDIER_SWORD });
    expect(sent[0]).not.toHaveProperty('armorClass');

    option(copy.weapon, goods.bow_long).click();
    option(copy.armor, goods.armor_chain).click();
    press(canvas);
    expect(sent[1]).toMatchObject({
      jobType: JOB_ARCHER_LONG,
      armorClass: CHAIN.armorClass,
      equipment: { weapon: { goodType: LONG_BOW_GOOD }, armor: { goodType: CHAIN.good } },
    });
  });

  it('arms the soldier as its group opens and as a weapon is picked after it was put away', () => {
    const { handle, plane, press, canvas, sent, option } = mount();
    handle.toggle.click();
    const soldiers = [...plane.querySelectorAll<HTMLButtonElement>('.on-admin__chip')].find((chip) =>
      chip.textContent?.startsWith(copy.groups.soldiers),
    );
    soldiers?.click();
    press(canvas);
    expect(sent[0]).toMatchObject({ jobType: JOB_SOLDIER_SWORD });

    press(canvas, 2); // a right click puts it away
    option(copy.weapon, goods.bow_long).click();
    press(canvas);
    expect(sent[1]).toMatchObject({ jobType: JOB_ARCHER_LONG });
  });

  it('enqueues the bio-ground waiver from the world tab', () => {
    const { handle, plane, sent } = mount();
    handle.toggle.click();
    const row = [...plane.querySelectorAll('.on-admin__row')].find(
      (r) => r.querySelector('b')?.textContent === copy.bioGround,
    );
    row?.querySelector<HTMLButtonElement>('.on-switch')?.click();
    expect(sent).toEqual([{ kind: 'setBioGroundWaived', waived: true }]);
  });

  it('spawns a man with every profession learned only when asked to', () => {
    const { handle, tile, press, canvas, sent, plane } = mount();
    handle.toggle.click();
    tile(copy.people.man).click();
    press(canvas);
    expect(sent[0]).toMatchObject({ jobType: JOB_CIVILIST });
    expect(sent[0]).not.toHaveProperty('experience');

    const all = [...plane.querySelectorAll<HTMLButtonElement>('.on-segmented button')].find(
      (b) => b.textContent === copy.skillModes.all,
    );
    all?.click();
    press(canvas);
    expect(sent[1]).toMatchObject({ jobType: JOB_CIVILIST, experience: LEARNED });
  });

  it('drops a held HUD placement whenever a map tool is armed, never as one is put away', () => {
    const { handle, tile, cancelPlacement } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    tile(copy.people.man).click();
    tile(copy.people.man).click();
    expect(cancelPlacement).toHaveBeenCalledTimes(2);
  });

  it('hands a finished structure to the HUD placement for the chosen owner', () => {
    const { handle, tile, enterStanding } = mount();
    handle.toggle.click();
    tile(copy.standingPalisade).click();
    tile(copy.standingRoad).click();
    tile(HALL.label).click();
    expect(enterStanding.mock.calls).toEqual([
      [{ kind: 'wall' }, 0, SEAT_TRIBE],
      [{ kind: 'road' }, 0, SEAT_TRIBE],
      [{ kind: 'building', typeId: HALL.typeId }, 0, SEAT_TRIBE],
    ]);
  });

  it('moves a picked settler to the next clicked node and waits for another pick', () => {
    const { handle, tile, press, canvas, sent, plane } = mount();
    handle.toggle.click();
    tile(copy.actions.teleport).click();
    const hint = (): string => plane.querySelector('.on-admin__status-text small')?.textContent ?? '';
    expect(hint()).toBe(copy.actionHints.teleport);
    press(canvas);
    expect(hint()).toBe(copy.hintTeleportDestination);
    press(canvas);
    expect(sent).toEqual([{ kind: 'debugTeleport', target: PICKED, x: TILE.col, y: TILE.row }]);
    expect(hint()).toBe(copy.actionHints.teleport);
  });

  it('keeps erasing under a held press, and acts once on a plain click', () => {
    vi.useFakeTimers();
    const { handle, tile, canvas, sent } = mount();
    handle.toggle.click();
    tile(copy.actions.erase).click();
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(sent).toEqual([{ kind: 'debugErase', target: PICKED }]);
    vi.advanceTimersByTime(HOLD_REPEAT_DELAY_MS + HOLD_REPEAT_INTERVAL_MS);
    expect(sent).toHaveLength(3);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    vi.advanceTimersByTime(HOLD_REPEAT_INTERVAL_MS);
    expect(sent).toHaveLength(3);
    vi.useRealTimers();
  });

  it('takes its DOM and window listeners down on dispose', () => {
    const { handle, tile, press, canvas, plane, sent } = mount();
    handle.toggle.click();
    tile(copy.soldier).click();
    handle.dispose();
    expect(canvas.style.cursor).toBe('');
    expect(plane.querySelector('.on-admin')).toBeNull();
    press(canvas);
    expect(sent).toEqual([]);
  });
});
