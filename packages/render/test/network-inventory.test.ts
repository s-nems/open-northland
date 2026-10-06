import {
  type EntityDelta,
  type EntitySnapshot,
  fx,
  packSnapshotDelta,
  type SignpostReachView,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { empireInventoryOf, networkInventoryOf } from '../src/data/hud/inventory.js';
import { buildHud } from '../src/data/hud/model.js';

const at = (x: number) => ({ x: fx.fromInt(x), y: fx.fromInt(8) });
const owner = { player: 1 };
const post = (id: number, x: number, links: number[] = [], player = 1): EntitySnapshot => ({
  id,
  components: { Owner: { player }, Position: at(x), Signpost: { links } },
});
const source = (id: number, x: number, components: EntitySnapshot['components']): EntitySnapshot => ({
  id,
  components: { Position: at(x), ...components },
});
const snapshot = (entities: readonly EntitySnapshot[]): WorldSnapshot => ({ tick: 0, events: [], entities });
const stock = (s: WorldSnapshot, id = 1) =>
  [...(networkInventoryOf(s, id)?.stock ?? [])].sort(([a], [b]) => a - b);
const touch = (
  id: number,
  components: EntitySnapshot['components'],
  removed: string[] = [],
): EntityDelta => ({ id, components, removed });

const opening: EntitySnapshot[] = [
  post(1, 10, [2]),
  post(2, 25, [1]),
  post(3, 90),
  post(4, 100, [], 2),
  source(10, 20, {
    Owner: owner,
    Building: {},
    Stockpile: { amounts: [[1, 10]] },
    Upgrading: { savedStock: [[2, 3]] },
  }),
  source(11, 20, { Stockpile: { amounts: [[1, 4]] } }),
  source(12, 20, { Owner: owner, Carrying: { goodType: 1, amount: 1 } }),
  source(13, 20, { Owner: { player: 2 }, Stockpile: { amounts: [[1, 100]] } }),
  source(14, 90, { Owner: owner, Stockpile: { amounts: [[1, 20]] } }),
  source(15, 90, { Stockpile: { amounts: [[2, 7]] } }),
  source(16, 150, { Stockpile: { amounts: [[1, 500]] } }),
  source(17, 20, {
    Owner: owner,
    Vehicle: { carrier: null },
    VehicleStock: { lines: [[1, { current: 6, reserved: 9, wanted: 20 }]] },
  }),
];

describe('network and empire inventory', () => {
  it('counts the same physical goods in a connected scope and across the empire, once per source', () => {
    const s = snapshot(opening);
    expect(networkInventoryOf(s, 1)?.postCount).toBe(2);
    expect(stock(s)).toEqual([
      [1, 21],
      [2, 3],
    ]);
    expect(stock(s, 2)).toEqual(stock(s));
    expect(stock(s, 3)).toEqual([
      [1, 20],
      [2, 7],
    ]);
    expect(buildHud(s, 1).stocks).toEqual([
      { goodType: 1, amount: 41 },
      { goodType: 2, amount: 10 },
    ]);
  });

  it('keeps empire totals available without signposts and excludes the strict range boundary', () => {
    const s = snapshot([
      post(1, 10),
      source(2, 30, { Stockpile: { amounts: [[1, 2]] } }),
      source(3, 29, { Stockpile: { amounts: [[1, 3]] } }),
    ]);
    expect(stock(s)).toEqual([[1, 3]]);
    const noPosts = snapshot([
      source(1, 90, { Owner: owner, Building: {}, Stockpile: { amounts: [[1, 8]] } }),
      source(2, 91, { Stockpile: { amounts: [[1, 2]] } }),
    ]);
    expect(buildHud(noPosts, 1).stocks).toEqual([{ goodType: 1, amount: 10 }]);
    expect(networkInventoryOf(noPosts, 1)).toBeNull();
  });

  it('maintains movement, cargo transfer, network split and removal from deltas without scanning the snapshot', () => {
    const mirror = new SnapshotMirror();
    let sequence = 0;
    const apply = (touched: EntityDelta[], removed: number[] = []) => {
      mirror.apply(
        packSnapshotDelta({
          tick: sequence,
          sequence,
          rebuild: sequence++ === 0,
          touched,
          removed,
          events: [],
        }),
      );
    };
    apply(opening.map((e) => touch(e.id, e.components)));
    expect(stock(mirror.snapshot())).toEqual([
      [1, 21],
      [2, 3],
    ]);
    const steps = [
      [touch(12, { Position: at(90) })],
      [
        touch(17, { VehicleStock: { lines: [[1, { current: 5, reserved: 9, wanted: 20 }]] } }),
        touch(18, { Owner: owner, Position: at(20), Carrying: { goodType: 1, amount: 1 } }),
      ],
      [touch(18, { Rider: { vehicle: 17 } }, ['Position'])],
      [touch(17, { Position: at(90) })],
      [touch(1, { Signpost: { links: [] } }), touch(2, { Signpost: { links: [] } })],
    ];
    for (const changes of steps) {
      apply(changes);
      const s = mirror.snapshot();
      const fresh = snapshot(s.entities);
      // The real mirror retains its indexes; reading repeatedly must return its maintained aggregate.
      const expected = stock(fresh);
      const expectedHud = { ...buildHud(fresh, 1), tick: s.tick };
      const entities = s.entities;
      Object.defineProperty(s, 'entities', {
        configurable: true,
        get: () => {
          throw new Error('unexpected full scan');
        },
      });
      expect(stock(s)).toEqual(expected);
      expect(stock(s)).toEqual(expected);
      expect(buildHud(s, 1)).toEqual(expectedHud);
      Object.defineProperty(s, 'entities', { configurable: true, value: entities });
      expect(mirror.verifyIndexes()).toEqual([]);
    }
    apply([], [1]);
    expect(networkInventoryOf(mirror.snapshot(), 1)).toBeNull();
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it('updates a split, reconnected and transferred network without adding overlapping stock twice', () => {
    const mirror = new SnapshotMirror();
    const opening = [
      post(1, 10, [2]),
      post(2, 28, [1]),
      source(3, 47, { Stockpile: { amounts: [[1, 7]] } }),
      source(4, 20, { Stockpile: { amounts: [[1, 3]] } }),
    ];
    let sequence = 0;
    const apply = (touched: EntityDelta[], removed: number[] = []) => {
      mirror.apply(
        packSnapshotDelta({
          tick: sequence,
          sequence,
          rebuild: sequence++ === 0,
          touched,
          removed,
          events: [],
        }),
      );
    };
    apply(opening.map((e) => touch(e.id, e.components)));
    expect(stock(mirror.snapshot())).toEqual([[1, 10]]);
    apply([touch(1, { Signpost: { links: [] } }), touch(2, { Signpost: { links: [] } })]);
    expect(networkInventoryOf(mirror.snapshot(), 1)?.postCount).toBe(1);
    expect(stock(mirror.snapshot())).toEqual([[1, 3]]);
    expect(stock(mirror.snapshot(), 2)).toEqual([[1, 10]]);
    expect(buildHud(mirror.snapshot(), 1).stocks).toEqual([{ goodType: 1, amount: 10 }]);
    apply([touch(1, { Signpost: { links: [2] } }), touch(2, { Signpost: { links: [1] } })]);
    expect(stock(mirror.snapshot())).toEqual([[1, 10]]);
    apply([touch(2, { Owner: { player: 2 } })]);
    expect(stock(mirror.snapshot())).toEqual([[1, 3]]);
    expect(networkInventoryOf(mirror.snapshot(), 1)?.postCount).toBe(1);
    apply([], [3, 4]);
    expect(stock(mirror.snapshot())).toEqual([]);
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it('moves cargo and passengers with a nested vehicle and never counts reservations', () => {
    const mirror = new SnapshotMirror();
    const entities = [
      post(1, 10),
      {
        id: 2,
        components: {
          Owner: owner,
          Vehicle: { carrier: 3 },
          VehicleStock: { lines: [[1, { current: 4, reserved: 99, wanted: 120 }]] },
        },
      },
      source(3, 10, { Owner: owner, Vehicle: { carrier: null } }),
      { id: 4, components: { Owner: owner, Rider: { vehicle: 2 }, Carrying: { goodType: 1, amount: 1 } } },
    ];
    mirror.apply(
      packSnapshotDelta({
        tick: 0,
        sequence: 0,
        rebuild: true,
        touched: entities.map((e) => touch(e.id, e.components)),
        removed: [],
        events: [],
      }),
    );
    expect(stock(mirror.snapshot())).toEqual([[1, 5]]);
    mirror.apply(
      packSnapshotDelta({
        tick: 1,
        sequence: 1,
        rebuild: false,
        touched: [touch(3, { Position: at(90) })],
        removed: [],
        events: [],
      }),
    );
    expect(stock(mirror.snapshot())).toEqual([]);
    expect(buildHud(mirror.snapshot(), 1).stocks).toEqual([{ goodType: 1, amount: 5 }]);
    expect(mirror.verifyIndexes()).toEqual([]);
  });
});

describe('inventory upkeep per step', () => {
  /** A quarter tile: four steps cross a node, so most steps stay on the node they left. */
  const QUARTER = 0.25;
  const along = (x: number) => ({ x: fx.fromFloat(x), y: fx.fromInt(8) });
  /** The empire's reach: the nodes of tiles 14 to 22 on the carriers' row. */
  const area = { minX: 28, maxX: 44, minY: 16, maxY: 16, cells: new Uint8Array(17).fill(1) };
  const reach: SignpostReachView = {
    key: 'band',
    player: 1,
    settlements: [],
    doors: new Map(),
    posts: [{ id: 1, group: 1, area }],
  };
  const network = (s: WorldSnapshot) =>
    [...(networkInventoryOf(s, 1)?.stock ?? [])].sort(([a], [b]) => a - b);
  const empire = (s: WorldSnapshot) => [...empireInventoryOf(s, reach)].sort(([a], [b]) => a - b);

  it('keeps the network, empire and owned totals equal to a fresh walk through every kind of step', () => {
    const mirror = new SnapshotMirror();
    let sequence = 0;
    const apply = (touched: EntityDelta[], removed: number[] = []) =>
      mirror.apply(
        packSnapshotDelta({
          tick: sequence,
          sequence,
          rebuild: sequence++ === 0,
          touched,
          removed,
          events: [],
        }),
      );
    apply(
      [
        post(1, 10),
        source(20, 4, { Owner: owner, Carrying: { goodType: 1, amount: 1 } }),
        source(21, 30, { Owner: owner, Carrying: { goodType: 2, amount: 3 } }),
        source(22, 4, { Owner: owner }),
        source(23, 4, {
          Owner: owner,
          Vehicle: { carrier: null },
          VehicleStock: { lines: [[1, { current: 5 }]] },
        }),
        {
          id: 24,
          components: { Owner: owner, Rider: { vehicle: 23 }, Carrying: { goodType: 2, amount: 1 } },
        },
        source(25, 18, {
          Owner: owner,
          Vehicle: { moored: true, mooring: { hx: 36, hy: 16 }, carrier: null },
          VehicleStock: { lines: [[2, { current: 4 }]] },
        }),
      ].map((e) => touch(e.id, e.components)),
    );
    const expectFresh = () => {
      const s = mirror.snapshot();
      const fresh = snapshot([...s.entities]);
      expect(network(s)).toEqual(network(fresh));
      expect(empire(s)).toEqual(empire(fresh));
      expect(buildHud(s, 1)).toEqual({ ...buildHud(fresh, 1), tick: s.tick });
      expect(mirror.verifyIndexes()).toEqual([]);
    };
    expectFresh();
    // Carrier 20 walks east through the network's range and the empire's band in quarter steps; the
    // empty-handed walker 22, the vehicle 23 with its rider and the moored hold 25 walk beside it.
    for (let x = 4; x <= 26; x += QUARTER) {
      apply([
        touch(20, { Position: along(x) }),
        touch(22, { Position: along(x) }),
        touch(23, { Position: along(x + 1) }),
        touch(25, { Position: along(18 + (x % 1)) }),
      ]);
      expectFresh();
    }
    // Carrier 21 walks back west while it changes hands, picks up more and sets down its load.
    const changes: EntitySnapshot['components'][] = [
      { Owner: { player: 2 } },
      { Owner: owner },
      { Carrying: { goodType: 2, amount: 5 } },
      { Carrying: { goodType: 1, amount: 2 } },
      {},
    ];
    let step = 0;
    for (let x = 30; x >= 2; x -= QUARTER) {
      apply([touch(21, { Position: along(x), ...(changes[step++ % changes.length] ?? {}) })]);
      expectFresh();
    }
    // The carrier steps off the map onto the vehicle, then back down beside it.
    apply([touch(20, { Rider: { vehicle: 23 } }, ['Position'])]);
    expectFresh();
    apply([touch(23, { Position: along(16) })]);
    expectFresh();
    apply([touch(20, { Position: along(16) }, ['Rider'])]);
    expectFresh();
    // The hold sails: its node follows its position again.
    apply([touch(25, { Vehicle: { moored: false, mooring: null, carrier: null }, Position: along(30) })]);
    expectFresh();
    apply([touch(25, { Position: along(17) })]);
    expectFresh();
    // A relocated post re-adds its `Signpost` where it stands now and takes its network's range along.
    apply([touch(1, { Position: along(4), Signpost: { links: [] } })]);
    expectFresh();
  });

  it('keeps the totals exact through dropped loads, a vehicle chain and riders touched beside their vehicle', () => {
    const mirror = new SnapshotMirror();
    let sequence = 0;
    const apply = (touched: EntityDelta[]) =>
      mirror.apply(
        packSnapshotDelta({
          tick: sequence,
          sequence,
          rebuild: sequence++ === 0,
          touched,
          removed: [],
          events: [],
        }),
      );
    const vehicle = (carrier: number | null) => ({ carrier });
    const hold = (good: number, units: number) => ({ lines: [[good, { current: units }]] });
    apply(
      [
        post(1, 10),
        // A rider whose id is below its vehicle's, and one whose id is above.
        { id: 3, components: { Owner: owner, Rider: { vehicle: 40 }, Carrying: { goodType: 1, amount: 1 } } },
        source(40, 4, { Owner: owner, Vehicle: vehicle(null), VehicleStock: hold(2, 2) }),
        {
          id: 41,
          components: { Owner: owner, Rider: { vehicle: 40 }, Carrying: { goodType: 2, amount: 3 } },
        },
        // A chain: a ship carrying a boat carrying a rider, only the ship on the ground.
        source(50, 4, { Owner: owner, Vehicle: vehicle(null), VehicleStock: hold(1, 4) }),
        { id: 51, components: { Owner: owner, Vehicle: vehicle(50), VehicleStock: hold(2, 5) } },
        {
          id: 52,
          components: { Owner: owner, Rider: { vehicle: 51 }, Carrying: { goodType: 1, amount: 6 } },
        },
        // A carrier that sets its load down on the way.
        source(60, 4, { Owner: owner, Carrying: { goodType: 1, amount: 7 } }),
      ].map((e) => touch(e.id, e.components)),
    );
    const expectFresh = (where: string) => {
      const s = mirror.snapshot();
      const fresh = snapshot([...s.entities]);
      expect(network(s), where).toEqual(network(fresh));
      expect(empire(s), where).toEqual(empire(fresh));
      expect(buildHud(s, 1), where).toEqual({ ...buildHud(fresh, 1), tick: s.tick });
      expect(mirror.verifyIndexes(), where).toEqual([]);
    };
    expectFresh('opening');
    let amount = 1;
    for (let x = 4; x <= 26; x += QUARTER) {
      amount++;
      apply([
        touch(3, { Carrying: { goodType: 1, amount } }),
        touch(40, { Position: along(x) }),
        touch(41, { Carrying: { goodType: 2, amount } }),
        touch(50, { Position: along(x + 1) }),
        touch(51, { VehicleStock: hold(2, amount) }),
        touch(52, { Carrying: { goodType: 1, amount } }),
        x === 15 ? touch(60, { Position: along(x) }, ['Carrying']) : touch(60, { Position: along(x) }),
      ]);
      expectFresh(`step to ${x}`);
    }
  });
});

describe('reach answers', () => {
  it('keeps the counted scopes for a new answer covering the same ground, and recounts a changed one', () => {
    const s = snapshot([post(1, 10), source(2, 20, { Stockpile: { amounts: [[1, 2]] } })]);
    const area = { minX: 40, maxX: 40, minY: 16, maxY: 16, cells: new Uint8Array([1]) };
    const reach: SignpostReachView = {
      key: 'a',
      player: 1,
      settlements: [],
      doors: new Map([[2, { hx: 40, hy: 16 }]]),
      posts: [{ id: 1, group: 1, area }],
    };
    const counted = empireInventoryOf(s, reach);
    const network = networkInventoryOf(s, 1, reach)?.stock;
    expect([...counted]).toEqual([[1, 2]]);
    // The host answers every reach version with a fresh copy.
    const again = structuredClone({ ...reach, key: 'b' });
    expect(empireInventoryOf(s, again)).toBe(counted);
    expect(networkInventoryOf(s, 1, again)?.stock).toBe(network);
    const moved = { ...again, key: 'c', doors: new Map([[2, { hx: 41, hy: 16 }]]) };
    expect(empireInventoryOf(s, moved)).not.toBe(counted);
    expect([...empireInventoryOf(s, moved)]).toEqual([]);
    expect([...(networkInventoryOf(s, 1, moved)?.stock ?? [])]).toEqual([]);
    const shrunk = {
      ...again,
      key: 'd',
      posts: [{ id: 1, group: 1, area: { ...area, cells: new Uint8Array([0]) } }],
    };
    expect([...empireInventoryOf(s, shrunk)]).toEqual([]);
  });
});

describe('authoritative network coverage', () => {
  it('counts a docked hold and nested passengers at the shore, then removes them when it sails', () => {
    const mirror = new SnapshotMirror();
    const ship = { moored: true, mooring: { hx: 20, hy: 16 }, carrier: null };
    const entities = [
      post(1, 10),
      source(2, 15, {
        Owner: owner,
        Vehicle: ship,
        VehicleStock: { lines: [[1, { current: 4, reserved: 9, wanted: 12 }]] },
      }),
      { id: 3, components: { Owner: owner, Vehicle: { carrier: 2 } } },
      { id: 4, components: { Owner: owner, Rider: { vehicle: 3 }, Carrying: { goodType: 1, amount: 2 } } },
    ];
    const reach: SignpostReachView = {
      key: 'shore',
      player: 1,
      settlements: [],
      doors: new Map(),
      posts: [
        { id: 1, group: 1, area: { minX: 20, maxX: 20, minY: 16, maxY: 16, cells: new Uint8Array([1]) } },
      ],
    };
    mirror.apply(
      packSnapshotDelta({
        tick: 0,
        sequence: 0,
        rebuild: true,
        touched: entities.map((e) => touch(e.id, e.components)),
        removed: [],
        events: [],
      }),
    );
    expect([...empireInventoryOf(mirror.snapshot(), reach)]).toEqual([[1, 6]]);
    expect([...(networkInventoryOf(mirror.snapshot(), 1, reach)?.stock ?? [])]).toEqual([[1, 6]]);
    mirror.apply(
      packSnapshotDelta({
        tick: 1,
        sequence: 1,
        rebuild: false,
        touched: [touch(2, { Vehicle: { ...ship, moored: false, mooring: null } })],
        removed: [],
        events: [],
      }),
    );
    expect([...empireInventoryOf(mirror.snapshot(), reach)]).toEqual([]);
    expect([...(networkInventoryOf(mirror.snapshot(), 1, reach)?.stock ?? [])]).toEqual([]);
    expect(mirror.verifyIndexes()).toEqual([]);
  });
  it('shares reachable goods between the network and empire, counts overlaps once, and reads building doors', () => {
    const s = snapshot([
      ...opening,
      source(20, 22, { Owner: owner, Building: {}, Stockpile: { amounts: [[1, 5]] } }),
    ]);
    const area = { minX: 40, maxX: 40, minY: 16, maxY: 16, cells: new Uint8Array([1]) };
    const reach: SignpostReachView = {
      key: 'open',
      player: 1,
      settlements: [],
      doors: new Map([
        [10, { hx: 60, hy: 16 }],
        [20, { hx: 40, hy: 16 }],
      ]),
      posts: [
        { id: 1, group: 1, area },
        { id: 2, group: 1, area },
      ],
    };
    expect([...(networkInventoryOf(s, 1, reach)?.stock ?? [])]).toEqual([[1, 16]]);
    expect([...empireInventoryOf(s, reach)]).toEqual([[1, 16]]);
    expect([...(networkInventoryOf(s, 2, reach)?.stock ?? [])]).toEqual([[1, 16]]);
    const closed = {
      ...reach,
      key: 'closed',
      posts: reach.posts.map((p) => ({ ...p, area: { ...area, cells: new Uint8Array([0]) } })),
    };
    expect([...(networkInventoryOf(s, 1, closed)?.stock ?? [])]).toEqual([]);
    expect([...empireInventoryOf(s, closed)]).toEqual([]);
    expect([...empireInventoryOf(s, reach)]).toEqual([[1, 16]]);
  });
});
