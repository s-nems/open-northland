import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { EquipRow, SettlerPanelModel } from '../src/hud/details-panel/model/index.js';
import { equipmentSockets } from '../src/hud/dom/settler-panel/equipment.js';
import { settlerHead } from '../src/hud/dom/settler-panel/head.js';
import { stanceSegment } from '../src/hud/dom/settler-panel/military.js';
import { needTooltip } from '../src/hud/dom/settler-panel/needs.js';
import {
  createPeerIndex,
  NO_PEERS,
  PEERS_REFRESH_MS,
  peerAt,
  tradePeers,
} from '../src/hud/dom/settler-panel/peers.js';
import { statusText, statusTone } from '../src/hud/dom/settler-panel/portrait.js';
import { familyValue, seatButton, seatValue } from '../src/hud/dom/settler-panel/work.js';
import type { ResidentRow } from '../src/hud/tool-panel/residents/rows.js';
import { messages } from '../src/i18n/index.js';

const SMITH = 13;
const BAKER = 20;

function resident(id: number, jobType: number | null): ResidentRow {
  return {
    id,
    name: `#${id}`,
    kind: 'worker',
    female: false,
    jobType,
    profession: '',
    ageYears: null,
    workplace: '',
    lacks: [],
  };
}

const ROWS = [resident(9, SMITH), resident(3, BAKER), resident(5, SMITH), resident(7, SMITH)];

describe('trade browsing', () => {
  it('lists the seat’s people of the trade in id order and places the selected one', () => {
    expect(tradePeers(ROWS, SMITH, 7)).toEqual({ ids: [5, 7, 9], index: 1 });
    expect(tradePeers(ROWS, SMITH, 3).index).toBe(-1);
  });

  it('steps to the neighbours, wrapping at both ends, and nowhere when alone', () => {
    const peers = tradePeers(ROWS, SMITH, 9);
    expect(peerAt(peers, 1)).toBe(5);
    expect(peerAt(peers, -1)).toBe(7);
    expect(peerAt(tradePeers(ROWS, BAKER, 3), 1)).toBeNull();
    expect(peerAt(NO_PEERS, 1)).toBeNull();
  });

  it('walks the people on a selection change and at most once per refresh window', () => {
    let reads = 0;
    let clock = 0;
    const index = createPeerIndex(
      () => {
        reads++;
        return ROWS;
      },
      () => clock,
    );
    index.peersOf(7, SMITH, true);
    index.peersOf(7, SMITH, false);
    clock += PEERS_REFRESH_MS - 1;
    index.peersOf(7, SMITH, false);
    expect(reads).toBe(1);
    clock += 1;
    index.peersOf(7, SMITH, false);
    expect(reads).toBe(2);
    index.peersOf(9, SMITH, false); // another person: a new list at once
    expect(reads).toBe(3);
  });
});

function row(group: EquipRow['group'], slots: EquipRow['slots'], wearable = true): EquipRow {
  return { slotLabel: group, group, slots, wearable };
}
const EMPTY = { occupied: false, conditionPct: null } as const;

describe('equipment sockets', () => {
  it('orders the worn slots weapon, armour, tool, boots and puts the bag in its own row', () => {
    const sockets = equipmentSockets(
      [
        row('boots', [EMPTY]),
        row('tool', [{ occupied: true, goodId: 'tool_iron', label: 'Tool', conditionPct: 12 }]),
        row('misc', [EMPTY, EMPTY, EMPTY, EMPTY]),
      ],
      false,
    );
    expect(sockets.worn.map((spec) => spec.ref.group)).toEqual(['tool', 'boots']);
    expect(sockets.bag).toHaveLength(4);
    const [tool, boots] = sockets.worn;
    expect(tool?.model).toMatchObject({ kind: 'item', wearPct: 12 });
    // A part-used item warns that taking it off destroys it.
    expect(tool?.model.kind === 'item' ? tool.model.removeLabel : null).toContain(
      messages().hud.usedItemDiscardHint,
    );
    expect(boots?.model).toMatchObject({ kind: 'empty' });
    expect(boots?.model.kind === 'empty' ? boots.model.ghost : null).not.toBeNull();
  });

  it('gives a hero its arms alone, flat, inert and not removable', () => {
    const arms = { occupied: true, goodId: 'sword', label: 'Sword', conditionPct: null } as const;
    const sockets = equipmentSockets(
      [
        row('weapon', [arms], false),
        row('armor', [EMPTY], false),
        row('boots', [EMPTY], false),
        row('misc', [EMPTY], false),
      ],
      true,
    );
    expect(sockets.worn.map((spec) => spec.ref.group)).toEqual(['weapon', 'armor']);
    expect(sockets.bag).toEqual([]);
    expect(sockets.worn.every((spec) => spec.fixed && !spec.pressable)).toBe(true);
    expect(sockets.worn[0]?.model.kind === 'item' ? sockets.worn[0].model.removeLabel : 'x').toBeNull();
  });
});

describe('the settler panel’s rows', () => {
  it('lights the stance segment the sim stamped, none for flight', () => {
    expect(stanceSegment(systems.MILITARY_MODE.DEFEND)).toBe('defend');
    expect(stanceSegment(systems.MILITARY_MODE.FLEE)).toBeNull();
    expect(stanceSegment(null)).toBeNull();
  });

  it('names the ring order a need row gives, and none for health', () => {
    expect(needTooltip({ label: 'Sen', pct: 40, hover: '40%', need: 'fatigue' })).toContain(
      messages().actionRing.sleep,
    );
    expect(needTooltip({ label: 'Zdrowie', pct: 40, hover: '4/10' })).toBe('Zdrowie: 4/10');
  });

  it('fades a refused seat button with the reason and blanks a missing one', () => {
    expect(seatButton(true, '', 'Assign', 'Hint')).toMatchObject({ enabled: true, tooltip: 'Hint' });
    expect(seatButton('Scripted', '', 'Assign', 'Hint')).toMatchObject({
      enabled: false,
      tooltip: 'Scripted',
    });
    expect(seatButton(null, '', 'Assign', 'Hint')).toBeNull();
  });

  it('reads an empty seat amber only when the player can fill it', () => {
    const copy = messages().hud.settlerPanel;
    expect(seatValue({ target: null, assign: true, remove: null }, '', false)).toEqual([
      { text: copy.missing, tone: 'missing' },
    ]);
    expect(seatValue({ target: null, assign: null, remove: null }, '', false)[0]?.tone).toBe('muted');
    // Another seat's person's workplace is named, not linked.
    expect(seatValue({ target: { id: 4, label: 'Kuźnia' }, assign: null, remove: null }, 't', true)).toEqual([
      { text: 'Kuźnia', link: false },
    ]);
  });

  it('offers "bez pary" as the partner pick only to a person free to marry', () => {
    const copy = messages().hud.settlerPanel;
    expect(familyValue({ partner: null, child: null, canPickPartner: true })[0]).toMatchObject({
      text: copy.noPartner,
      link: true,
      tone: 'missing',
    });
    expect(familyValue({ partner: null, child: null, canPickPartner: false })[0]?.link).toBeUndefined();
    expect(
      familyValue({
        partner: { id: 2, label: 'Astrid' },
        child: { id: 3, label: 'Tove' },
        canPickPartner: false,
      }).map((segment) => segment.text),
    ).toEqual(['Astrid', 'Tove']);
  });

  it('writes the state and its detail after a dot', () => {
    const status = {
      state: 'idle',
      label: 'Bezczynny',
      detail: null,
      trouble: true,
      carrying: null,
    } as const;
    expect(statusText(status)).toBe('Bezczynny');
    expect(statusText({ ...status, detail: 'bez zawodu' })).toBe('Bezczynny · bez zawodu');
  });

  it('colours the status dot amber for trouble, grey for a walk or a wait, green for anything done', () => {
    const status = { label: '', detail: null, trouble: false, carrying: null } as const;
    expect(statusTone({ ...status, state: 'idle', trouble: true })).toBe('trouble');
    expect(statusTone({ ...status, state: 'walking' })).toBe('neutral');
    expect(statusTone({ ...status, state: 'awaitingWorkplace' })).toBe('neutral');
    expect(statusTone({ ...status, state: 'talking' })).toBe('ok');
    expect(statusTone({ ...status, state: 'working' })).toBe('ok');
  });
});

describe('the settler head', () => {
  const model = {
    kind: 'settler',
    entityId: 7,
    name: 'Ulf',
    profession: 'Kowal',
    foreign: false,
    renamable: true,
    meta: null,
  } as SettlerPanelModel;

  it('browses the trade, offers rename and the orders medallion for the seat’s own person', () => {
    const head = settlerHead(model, { ids: [5, 7, 9], index: 1 }, 'Spacja');
    expect(head.browse).toMatchObject({ index: 2, count: 3 });
    expect(head.rename).not.toBeNull();
    expect(head.orders?.tooltip).toContain('Spacja');
  });

  it('keeps another seat’s person to the name alone', () => {
    const head = settlerHead({ ...model, foreign: true, renamable: false }, NO_PEERS, 'Spacja');
    expect(head.browse).toBeNull();
    expect(head.rename).toBeNull();
    expect(head.orders).toBeNull();
  });
});
