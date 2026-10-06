import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { EquipRow, SettlerPanelModel } from '../src/hud/details-panel/model/index.js';
import { PRODUCTION_UNLIMITED } from '../src/hud/details-panel/model/index.js';
import { socketWearTone } from '../src/hud/dom/parts/socket.js';
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
import { toggledProductionCount } from '../src/hud/dom/settler-panel/production.js';
import {
  familyButton,
  familyValue,
  seatButton,
  seatValue,
  vehicleValue,
} from '../src/hud/dom/settler-panel/work.js';
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
    products: null,
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
    expect(tool?.model).toMatchObject({ kind: 'item', wearPct: 12, inert: false });
    // A part-used item warns that taking it off destroys it.
    expect(tool?.model.kind === 'item' ? tool.model.removeLabel : null).toContain(
      messages().hud.usedItemDiscardHint,
    );
    expect(boots?.model).toMatchObject({ kind: 'empty' });
    expect(boots?.model.kind === 'empty' ? boots.model.ghost : null).not.toBeNull();
  });

  it('gives a hero only the arms it carries, locked and not removable', () => {
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
    // The armour slot this hero's class leaves empty is not shown.
    expect(sockets.worn.map((spec) => spec.ref.group)).toEqual(['weapon']);
    expect(sockets.bag).toEqual([]);
    expect(sockets.worn.every((spec) => spec.fixed && spec.model.inert)).toBe(true);
    expect(sockets.worn[0]?.model.kind === 'item' ? sockets.worn[0].model.removeLabel : 'x').toBeNull();
    const armed = equipmentSockets([row('weapon', [arms], false), row('armor', [arms], false)], true);
    expect(armed.worn.map((spec) => spec.ref.group)).toEqual(['weapon', 'armor']);
  });

  it('keeps a woman’s slots in place, faded and inert, saying she wears nothing', () => {
    const sockets = equipmentSockets(
      [row('boots', [EMPTY], false), row('tool', [EMPTY], false), row('misc', [EMPTY, EMPTY], false)],
      false,
    );
    expect(sockets.worn.map((spec) => spec.ref.group)).toEqual(['tool', 'boots']);
    expect(sockets.bag).toHaveLength(2);
    for (const spec of [...sockets.worn, ...sockets.bag]) {
      expect(spec.fixed).toBe(false);
      expect(spec.model).toMatchObject({ kind: 'empty', inert: true });
      expect(spec.model.tooltip).toContain(messages().hud.settlerPanel.cannotWear.split(':')[1]?.trim());
    }
    const wearable = equipmentSockets([row('boots', [EMPTY])], false);
    expect(wearable.worn[0]?.model).toMatchObject({ kind: 'empty', inert: false });
  });

  it('marks an item the picker cannot swap, a fighter’s stray tool, inert', () => {
    const tool = { occupied: true, goodId: 'tool_iron', label: 'Tool', conditionPct: null } as const;
    const [socket] = equipmentSockets([row('tool', [tool], false)], false).worn;
    expect(socket?.model).toMatchObject({ kind: 'item', inert: true });
  });
});

describe('the settler panel’s rows', () => {
  it('lights the stance segment the sim stamped, none for flight', () => {
    expect(stanceSegment(systems.MILITARY_MODE.DEFEND)).toBe('defend');
    expect(stanceSegment(systems.MILITARY_MODE.FLEE)).toBeNull();
    expect(stanceSegment(null)).toBeNull();
  });

  it('names the ring order a need row gives, and none for health', () => {
    expect(
      needTooltip(
        { label: 'Sen', pct: 40, hover: '40%', need: 'fatigue' },
        (_table, _id, fallback) => fallback,
      ),
    ).toContain(messages().actionRing.sleep);
    expect(
      needTooltip({ label: 'Sen', pct: 40, hover: '40%', need: 'fatigue' }, () => 'fixture rest order'),
    ).toContain('fixture rest order');
    expect(
      needTooltip({ label: 'Zdrowie', pct: 40, hover: '4/10' }, (_table, _id, fallback) => fallback),
    ).toBe('Zdrowie: 4/10');
  });

  it('offers the rings to a person free to marry and fades them while the wedding runs', () => {
    const copy = messages().hud.settlerPanel;
    const free = { partner: null, child: null, marry: true, childOnHold: null } as const;
    expect(familyButton(free)).toMatchObject({ enabled: true, tooltip: copy.noPartnerTooltip });
    expect(familyButton({ ...free, marry: copy.weddingUnderWay })).toMatchObject({
      enabled: false,
      tooltip: copy.weddingUnderWay,
    });
    expect(familyButton({ ...free, marry: null })).toBeNull();
  });

  it('starts a stopped good for good on Ctrl and stops a running one', () => {
    expect(toggledProductionCount(0)).toBe(PRODUCTION_UNLIMITED);
    expect(toggledProductionCount(7)).toBe(0);
    expect(toggledProductionCount(PRODUCTION_UNLIMITED)).toBe(0);
  });

  it('colours the wear fill green, amber under half, red under a quarter', () => {
    expect(socketWearTone(80)).toBe('fresh');
    expect(socketWearTone(49)).toBe('wearing');
    expect(socketWearTone(24)).toBe('worn');
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

  it('offers "bez pary" as the partner search only to a person free to marry', () => {
    const copy = messages().hud.settlerPanel;
    expect(familyValue({ partner: null, child: null, marry: true, childOnHold: null })[0]).toMatchObject({
      text: copy.noPartner,
      link: true,
      tone: 'missing',
    });
    expect(
      familyValue({ partner: null, child: null, marry: null, childOnHold: null })[0]?.link,
    ).toBeUndefined();
    expect(
      familyValue({ partner: null, child: null, marry: copy.weddingUnderWay, childOnHold: null })[0]?.link,
    ).toBeUndefined();
    expect(
      familyValue({
        partner: { id: 2, label: 'Astrid' },
        child: { id: 3, label: 'Tove' },
        marry: null,
        childOnHold: null,
      }).map((segment) => segment.text),
    ).toEqual(['Astrid', 'Tove']);
  });

  it("names what holds the couple's child order after the spouse, in amber with the whole sentence", () => {
    const held = familyValue({
      partner: { id: 2, label: 'Olaf' },
      child: null,
      marry: null,
      childOnHold: { label: 'Husband away', tooltip: 'Astrid cannot have a child' },
    });
    expect(held.map((segment) => segment.text)).toEqual(['Olaf', 'Husband away']);
    expect(held[1]).toMatchObject({ tone: 'missing', tooltip: 'Astrid cannot have a child' });
  });

  it('links the vehicle with its hold, else offers the pick in amber while the player may assign', () => {
    const copy = messages().hud.settlerPanel;
    const cart = { id: 7, label: 'Wóz ręczny', load: 'Wóz ręczny: 3 drewno' };
    expect(vehicleValue({ target: cart, assign: true, remove: true })).toEqual([
      { text: 'Wóz ręczny', link: true, tooltip: 'Wóz ręczny: 3 drewno' },
    ]);
    expect(vehicleValue({ target: null, assign: true, remove: null })).toEqual([
      { text: copy.assignVehicle, link: true, tone: 'missing', tooltip: copy.assignVehicleTooltip },
    ]);
    expect(vehicleValue({ target: null, assign: copy.scripted, remove: null })).toEqual([
      { text: copy.missing, tone: 'muted' },
    ]);
  });

  it('writes the state and its detail after a dot', () => {
    const status = {
      state: 'idle',
      label: 'Bezczynny',
      detail: null,
      trouble: true,
      lostGoal: null,
      carrying: null,
    } as const;
    expect(statusText(status)).toBe('Bezczynny');
    expect(statusText({ ...status, detail: 'bez zawodu' })).toBe('Bezczynny · bez zawodu');
  });

  it('colours the status dot amber for trouble, grey for a walk or a wait, green for anything done', () => {
    const status = { label: '', detail: null, trouble: false, lostGoal: null, carrying: null } as const;
    expect(statusTone({ ...status, state: 'idle', trouble: true })).toBe('trouble');
    expect(statusTone({ ...status, state: 'lost', trouble: true })).toBe('trouble');
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

  it('drops the chevrons while the person is the only one of the trade', () => {
    const head = settlerHead(model, { ids: [7], index: 0 }, 'Spacja');
    expect(head.browse).toBeNull();
    expect(head.orders).not.toBeNull();
  });

  it('keeps another seat’s person to the name alone', () => {
    const head = settlerHead({ ...model, foreign: true, renamable: false }, NO_PEERS, 'Spacja');
    expect(head.browse).toBeNull();
    expect(head.rename).toBeNull();
    expect(head.orders).toBeNull();
  });
});
