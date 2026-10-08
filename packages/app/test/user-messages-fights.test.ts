import {
  type Entity,
  fx,
  type HalfCellNode,
  hexDistanceBetween,
  nodeOfPosition,
  ONE,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  createMessageFeed,
  MESSAGE_LIFETIME_TICKS,
  type MessageFeedState,
  takeRaised,
} from '../src/hud/tool-panel/messages/feed.js';
import {
  FIGHT_AREA_RADIUS_NODES,
  FIGHT_QUIET_TICKS,
  FightAreas,
  shownFightAt,
} from '../src/hud/tool-panel/messages/fight-areas.js';
import { messagesFromEvents } from '../src/hud/tool-panel/messages/from-events.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../src/hud/tool-panel/messages/retire.js';
import { composeMessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE, type UserMessage } from '../src/hud/tool-panel/messages/types.js';
import { en } from '../src/i18n/en.js';

const LOCAL = 0;
const ENEMY = 1;
const ALLY = 2;
const e = (id: number): Entity => id as Entity;

interface Body {
  readonly id: number;
  readonly kind: 'person' | 'animal' | 'building' | 'wall' | 'vehicle';
  /** Absent for an unowned body: a wolf or a monster. */
  readonly player?: number;
  readonly x: number;
  readonly y: number;
}

const HOME: Body = { id: 1, kind: 'building', player: LOCAL, x: 10, y: 10 };
const VILLAGER: Body = { id: 2, kind: 'person', player: LOCAL, x: 12, y: 10 };
const NEIGHBOUR: Body = { id: 3, kind: 'person', player: LOCAL, x: 10, y: 12 };
const WOODCUTTER: Body = { id: 4, kind: 'person', player: LOCAL, x: 40, y: 40 };
const WOLF: Body = { id: 5, kind: 'animal', x: 41, y: 40 };
const RAIDER: Body = { id: 6, kind: 'person', player: ENEMY, x: 11, y: 11 };
const CATAPULT: Body = { id: 7, kind: 'vehicle', player: LOCAL, x: 14, y: 10 };
const FAR_HUNTER: Body = { id: 8, kind: 'person', player: LOCAL, x: 40, y: 80 };
const OUTER_WALL: Body = { id: 9, kind: 'wall', player: LOCAL, x: 70, y: 10 };
const BODIES = [HOME, VILLAGER, NEIGHBOUR, WOODCUTTER, WOLF, RAIDER, CATAPULT, FAR_HUNTER, OUTER_WALL];

function entityOf(b: Body): WorldSnapshot['entities'][number] {
  return {
    id: b.id,
    components: {
      ...(b.player === undefined ? {} : { Owner: { player: b.player } }),
      Position: { x: b.x * ONE, y: b.y * ONE },
      ...(b.kind === 'building'
        ? { Building: { buildingType: 12, tribe: 1, built: ONE, level: 0 } }
        : b.kind === 'wall'
          ? { Palisade: { gfxIndex: 1, tribe: 1, built: ONE } }
          : b.kind === 'vehicle'
            ? { Vehicle: { vehicleType: 2, tribe: 1, task: 'none', passengers: [null] } }
            : { Settler: { tribe: 1, jobType: 7 } }),
      ...(b.kind === 'person' ? { Person: { person: true } } : {}),
    },
  };
}

function world(tick: number, bodies: readonly Body[] = BODIES): WorldSnapshot {
  return { tick, events: [], entities: [...bodies].sort((a, b) => a.id - b.id).map(entityOf) };
}

const nodeOf = (b: Body) => nodeOfPosition(fx.fromInt(b.x), fx.fromInt(b.y));

function melee(attacker: Body, target: Body): SimEvent {
  return {
    kind: 'combatHit',
    damage: 250,
    targetMaxHealth: 1000,
    attacker: e(attacker.id),
    ...(attacker.player === undefined ? {} : { attackerPlayer: attacker.player }),
    target: e(target.id),
    at: nodeOf(target),
  };
}

function shot(shooterPlayer: number, target: Body, collateral = false): SimEvent {
  return {
    kind: 'projectileHit',
    damage: 250,
    targetMaxHealth: 1000,
    projectile: e(99),
    shooter: e(98),
    shooterPlayer,
    ...(collateral ? { collateral: true } : {}),
    target: e(target.id),
    munitionType: 2,
    at: nodeOf(target),
  };
}

const naming: MessageNaming = {
  settler: (s) => ({ name: `S${s.id}`, jobLabel: null, female: false }),
  building: () => 'House',
  vehicle: () => 'Cart',
  player: (player) => `Player ${player + 1}`,
  stance: (state) => state,
  paper: (paper) => paper.kind,
  technology: () => undefined,
  text: (type, parts) => composeMessageText(type, parts, en.userMessages, 'en'),
};

/** The message centre's per-frame loop over the feed, without the column; `alarms` collects the hits
 *  the minimap rings. */
function centre(initial?: MessageFeedState) {
  const feed = createMessageFeed(initial);
  const fights = FightAreas.adopt(initial);
  const retirement = new NoteRetirement(fights);
  const alarms: HalfCellNode[] = [];
  return {
    feed,
    fights,
    alarms,
    frame(snapshot: WorldSnapshot, events: readonly SimEvent[], departed: WorldSnapshot['entities'] = []) {
      for (const raised of messagesFromEvents(
        events,
        snapshot,
        departed,
        LOCAL,
        naming,
        () => undefined,
        fights,
      )) {
        const at = shownFightAt(feed, raised.pending, takeRaised(feed, raised, snapshot.tick));
        if (at !== null) alarms.push(at);
      }
      feed.expire(snapshot.tick, (m) => retirement.isOver(m, snapshot));
      retirement.endPass();
    },
  };
}

const TICK = 100;
/** The filter level that shows only the urgent notes: a settlement raid, not an attack in the field. */
const URGENT_ONLY = 2;
const summary = (m: UserMessage) => ({ id: m.id, type: m.type, priority: m.priority, fight: m.fight });

describe('fight notices', () => {
  it('reports wolves on a woodcutter in the forest as an attack outside the settlement', () => {
    const c = centre();
    c.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    expect(c.feed.live().map(summary)).toEqual([
      {
        id: 1,
        type: USER_MESSAGE_TYPE.peopleAttacked,
        priority: 1,
        fight: { buildings: 0, walls: 0, settlers: 1, vehicles: 0, seats: [], wild: true, lastHitTick: TICK },
      },
    ]);
    const [note] = c.feed.live();
    expect(note?.at).toEqual(nodeOf(WOODCUTTER));
    expect(note?.text.full).toContain('Enemy: wild beasts. Hit: 1 settler.');
  });

  it('reports a raid on the buildings as one urgent settlement card that follows the raid', () => {
    const c = centre();
    c.frame(world(TICK), [shot(ENEMY, HOME), melee(RAIDER, VILLAGER)]);
    c.frame(world(TICK + 1), [melee(RAIDER, NEIGHBOUR)]);
    expect(c.feed.live().map(summary)).toEqual([
      {
        id: 1,
        type: USER_MESSAGE_TYPE.settlementAttacked,
        priority: 2,
        fight: {
          buildings: 1,
          walls: 0,
          settlers: 2,
          vehicles: 0,
          seats: [ENEMY],
          wild: false,
          lastHitTick: TICK + 1,
        },
      },
    ]);
    const [note] = c.feed.live();
    // The card goes to the latest hit and words the whole raid so far.
    expect(note?.at).toEqual(nodeOf(NEIGHBOUR));
    expect(note?.text.full).toBe(
      'Your settlement is under attack. Enemy: Player 2. Hit: 1 building, 2 settlers. Send soldiers to defend it.',
    );
  });

  it('counts a wall as part of the settlement wherever it stands', () => {
    const c = centre();
    c.frame(world(TICK), [shot(ENEMY, OUTER_WALL)]);
    expect(c.feed.live().map((m) => [m.type, m.fight?.walls, m.fight?.buildings])).toEqual([
      [USER_MESSAGE_TYPE.settlementAttacked, 1, 0],
    ]);
  });

  it('tells the two notices apart by the place of the hit, not by the attacker', () => {
    const c = centre();
    c.frame(world(TICK), [melee(RAIDER, WOODCUTTER), melee(WOLF, VILLAGER)]);
    expect(c.feed.live().map((m) => [m.type, m.fight?.seats, m.fight?.wild])).toEqual([
      [USER_MESSAGE_TYPE.peopleAttacked, [ENEMY], false],
      [USER_MESSAGE_TYPE.settlementAttacked, [], true],
    ]);
  });

  it('keeps one standing card through a long siege instead of raising it anew', () => {
    const c = centre();
    const SIEGE_STEP = FIGHT_QUIET_TICKS / 3;
    for (let tick = TICK; tick <= TICK + 2 * MESSAGE_LIFETIME_TICKS; tick += SIEGE_STEP) {
      c.frame(world(tick), [shot(ENEMY, HOME)]);
      expect(c.feed.live().map((m) => m.id)).toEqual([1]);
    }
  });

  it('raises nothing for own fire or for splash from a side not at war with the seat', () => {
    const c = centre();
    c.frame(world(TICK), [
      shot(LOCAL, VILLAGER, true),
      shot(LOCAL, CATAPULT, true),
      shot(ALLY, NEIGHBOUR, true),
      melee(CATAPULT, VILLAGER),
    ]);
    expect(c.feed.live()).toEqual([]);
  });

  it('counts the killing blow, whose victim only the departed entities still hold', () => {
    const c = centre();
    const alive = BODIES.filter((b) => b !== WOODCUTTER);
    c.frame(world(TICK, alive), [melee(WOLF, WOODCUTTER)], [entityOf(WOODCUTTER)]);
    expect(c.feed.live().map((m) => [m.type, m.fight?.settlers])).toEqual([
      [USER_MESSAGE_TYPE.peopleAttacked, 1],
    ]);
  });

  it('retires the card once its area has gone quiet', () => {
    const c = centre();
    c.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    c.frame(world(TICK + FIGHT_QUIET_TICKS - 1), []);
    expect(c.feed.live()).toHaveLength(1);
    c.frame(world(TICK + FIGHT_QUIET_TICKS), []);
    expect(c.feed.live()).toEqual([]);
  });

  it('keeps a dismissed fight away while it lasts, and raises the next fight there', () => {
    const c = centre();
    c.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    c.feed.remove(1, TICK);
    const later = TICK + FIGHT_QUIET_TICKS - 1;
    c.frame(world(later), [melee(WOLF, WOODCUTTER)]);
    expect(c.feed.live()).toEqual([]);
    // The dismissed card still follows the fight, so a remount adopts it as standing.
    expect(c.feed.state().history.map((m) => m.fight?.lastHitTick)).toEqual([later]);
    c.frame(world(later + FIGHT_QUIET_TICKS), []);
    expect(c.feed.state().history).toEqual([]);
    c.frame(world(later + FIGHT_QUIET_TICKS + 1), [melee(WOLF, WOODCUTTER)]);
    expect(c.feed.live().map((m) => m.id)).toEqual([2]);
  });

  it('rings the minimap once per new card the level shows, where the card points', () => {
    const c = centre();
    c.frame(world(TICK), [shot(ENEMY, HOME), melee(RAIDER, VILLAGER)]);
    c.frame(world(TICK + 1), [melee(RAIDER, NEIGHBOUR)]);
    // The card points at its frame's latest hit, and the raid's later hits only revise it.
    expect(c.alarms).toEqual([nodeOf(VILLAGER)]);
    c.frame(world(TICK + 2), [melee(WOLF, WOODCUTTER)]);
    expect(c.alarms).toEqual([nodeOf(VILLAGER), nodeOf(WOODCUTTER)]);
  });

  it('rings nothing for a dismissed fight that goes on, nor for a card the level hides', () => {
    const c = centre();
    c.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    c.feed.remove(1, TICK);
    c.frame(world(TICK + 1), [melee(WOLF, WOODCUTTER)]);
    expect(c.alarms).toEqual([nodeOf(WOODCUTTER)]);

    const hidden = centre();
    hidden.feed.setLevel(URGENT_ONLY);
    hidden.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    expect(hidden.feed.live()).toHaveLength(1);
    expect(hidden.alarms).toEqual([]);
    hidden.frame(world(TICK + 1), [shot(ENEMY, HOME)]);
    expect(hidden.alarms).toEqual([nodeOf(HOME)]);
  });

  it('gives fights farther apart than the area radius a card each', () => {
    expect(hexDistanceOf(WOODCUTTER, FAR_HUNTER)).toBeGreaterThan(FIGHT_AREA_RADIUS_NODES);
    const c = centre();
    c.frame(world(TICK), [melee(WOLF, WOODCUTTER), melee(WOLF, FAR_HUNTER)]);
    expect(c.feed.live().map((m) => m.about)).toEqual([1, 2]);
  });

  it('adopts the standing fights of a restored feed, keeping their cards and never reusing their ids', () => {
    const first = centre();
    first.frame(world(TICK), [melee(WOLF, WOODCUTTER)]);
    const restored = centre(first.feed.state());
    restored.frame(world(TICK + 1), [melee(WOLF, WOODCUTTER), melee(RAIDER, VILLAGER)]);
    expect(restored.feed.live().map((m) => [m.id, m.about, m.fight?.lastHitTick])).toEqual([
      [1, 1, TICK + 1],
      [2, 2, TICK + 1],
    ]);
  });
});

function hexDistanceOf(a: Body, b: Body): number {
  const na = nodeOf(a);
  const nb = nodeOf(b);
  return hexDistanceBetween(na.hx, na.hy, nb.hx, nb.hy);
}
