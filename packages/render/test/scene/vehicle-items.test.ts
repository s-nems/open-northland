import { components, FOG_STATE, ONE, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FogGhostStore } from '../../src/data/fog/index.js';
import { tileToScreen } from '../../src/data/projection/index.js';
import { buildSpriteScene } from '../../src/data/scene/index.js';
import { classify } from '../../src/data/scene/snapshot-readers/index.js';
import { GFX_DIR_TO_FACING } from '../../src/data/sprites/settler.js';
import { entity, fogViewOf, snapshotOf } from '../support/fixtures.js';

/**
 * A `Vehicle` entity becomes one `vehicle` draw item carrying its binding keys, heading, owner, task and
 * load, drives along its `VehicleDrive` leg, ghosts through the fog like a building, stages its shot
 * smoke while attacking, and marks the settlers seated in it as crew. Component shapes mirror
 * `packages/sim/src/components/vehicle.ts` as the snapshot clones them (Maps as `[key, value]` pairs).
 */

const { NODE_PROGRESS_FULL } = components;

const OXCART = 2;
const CATAPULT = 5;
const VIKING = 1;
const PLAYER = 3;
const WOOD = 5;
const STONE = 4;
const HEX_SOUTH_WEST = 2;
/** The fixture stands on cell `(4, 2)`, half-cell node `(8, 4)`; a leg into it leaves the node one cell west. */
const LEG_FROM = { hx: 6, hy: 4 } as const;
const GOAL = { hx: 12, hy: 4 } as const;

/** A drive whose leg from `LEG_FROM` into the anchor is `progress` along; null `from` is between legs. */
function drive(progress: number, from: { hx: number; hy: number } | null = LEG_FROM) {
  return { goal: GOAL, route: [{ hx: 10, hy: 4 }], from, progress, increment: NODE_PROGRESS_FULL / 4 };
}

function vehicle(
  id: number,
  fields: Partial<{
    vehicleType: number;
    facing: number;
    task: string;
    moored: boolean;
    lines: [number, { current: number; wanted: number; reserved: number }][];
    passengers: ({ entity: number; inside: boolean } | null)[];
    drive: ReturnType<typeof drive>;
  }> = {},
) {
  return entity(id, 4, 2, {
    Vehicle: {
      vehicleType: fields.vehicleType ?? OXCART,
      tribe: VIKING,
      task: fields.task ?? 'none',
      facing: fields.facing ?? 0,
      moored: fields.moored ?? false,
      mooring: null,
      harnessed: false,
      carrier: null,
      passengers: fields.passengers ?? [null],
      vehicles: [],
    },
    VehicleStock: { lines: fields.lines ?? [] },
    Health: { hitpoints: 1000, max: 1000 },
    Owner: { player: PLAYER },
    ...(fields.drive !== undefined ? { VehicleDrive: fields.drive } : {}),
  });
}

describe('vehicle draw items', () => {
  it('classifies a Vehicle entity as the vehicle kind', () => {
    expect(classify(vehicle(1).components)).toBe('vehicle');
  });

  it('carries the binding keys, the remapped heading, the owner and the task', () => {
    const [item] = buildSpriteScene(
      snapshotOf([vehicle(1, { vehicleType: CATAPULT, facing: HEX_SOUTH_WEST, task: 'attacks' })]),
    );
    expect(item).toMatchObject({
      kind: 'vehicle',
      ref: 1,
      typeId: CATAPULT,
      tribe: VIKING,
      facing: GFX_DIR_TO_FACING[HEX_SOUTH_WEST],
      player: PLAYER,
      task: 'attacks',
      state: 'idle',
    });
    expect(item?.carrying).toBeUndefined();
    expect(item?.moored).toBeUndefined();
  });

  it('reads a moored ship as such', () => {
    const [item] = buildSpriteScene(snapshotOf([vehicle(1, { moored: true })]));
    expect(item?.moored).toBe(true);
  });

  it('reads the hold as the load, the fullest good first, and the drive as motion', () => {
    const [item] = buildSpriteScene(
      snapshotOf([
        vehicle(1, {
          drive: drive(0, null),
          lines: [
            [STONE, { current: 2, wanted: 0, reserved: 0 }],
            [WOOD, { current: 5, wanted: 0, reserved: 0 }],
          ],
        }),
      ]),
    );
    expect(item).toMatchObject({ state: 'moving', carrying: true, carryGood: WOOD });
    const [empty] = buildSpriteScene(
      snapshotOf([vehicle(1, { lines: [[WOOD, { current: 0, wanted: 4, reserved: 0 }]] })]),
    );
    expect(empty?.carrying).toBeUndefined();
  });

  it('draws a driving vehicle part-way from the node its leg left toward its anchor', () => {
    const quarter = NODE_PROGRESS_FULL / 4;
    const [item] = buildSpriteScene(snapshotOf([vehicle(1, { drive: drive(quarter) })]));
    const left = positionOfNode(LEG_FROM.hx, LEG_FROM.hy);
    const leftTile = { x: left.x / ONE, y: left.y / ONE };
    const expected = tileToScreen(leftTile.x + (4 - leftTile.x) / 4, 2);
    expect(item?.x).toBeCloseTo(expected.x);
    expect(item?.y).toBeCloseTo(expected.y);
    // A finished leg and a settler's stale path components change nothing: the anchor is the tile.
    const [arrived] = buildSpriteScene(snapshotOf([vehicle(1, { drive: drive(NODE_PROGRESS_FULL, null) })]));
    expect(arrived).toMatchObject({ ...tileToScreen(4, 2), state: 'moving' });
    const [walkerShaped] = buildSpriteScene(
      snapshotOf([entity(1, 4, 2, { ...vehicle(1).components, PathFollow: { waypoints: [], index: 0 } })]),
    );
    expect(walkerShaped).toMatchObject({ ...tileToScreen(4, 2), state: 'idle' });
  });

  it('slides a diagonal leg out of an odd half-row straight on screen, across the stagger kink', () => {
    // Node (9, 5) -> (10, 7): both on odd half-rows, the leg crossing integer row 3 where the stagger
    // kinks. Halfway, the hull must sit on the screen midpoint of the two nodes, not a quarter column off.
    const from = { hx: 9, hy: 5 };
    const to = positionOfNode(10, 7);
    const { Position: _fixtureCell, ...base } = vehicle(1).components;
    const midway = { goal: GOAL, route: [], from, progress: NODE_PROGRESS_FULL / 2, increment: 1 };
    const [item] = buildSpriteScene(
      snapshotOf([entity(1, to.x / ONE, to.y / ONE, { ...base, VehicleDrive: midway })]),
    );
    const left = positionOfNode(from.hx, from.hy);
    const start = tileToScreen(left.x / ONE, left.y / ONE);
    const end = tileToScreen(to.x / ONE, to.y / ONE);
    expect(item?.x).toBeCloseTo((start.x + end.x) / 2);
    expect(item?.y).toBeCloseTo((start.y + end.y) / 2);
  });

  it('maps the owner slot through playerColourOf like a settler', () => {
    const [item] = buildSpriteScene(snapshotOf([vehicle(1)]), { playerColourOf: (p) => p + 10 });
    expect(item?.player).toBe(PLAYER + 10);
  });

  it('names the commander riding inside as its driver, and nobody while he walks outside', () => {
    const TRADER = 25;
    const commander = { components: { Settler: { jobType: TRADER, tribe: VIKING } } };
    const seated = (inside: boolean) =>
      buildSpriteScene(
        snapshotOf([vehicle(1, { passengers: [null, { entity: 2, inside }] }), { id: 2, ...commander }]),
      ).find((i) => i.ref === 1);
    expect(seated(true)?.driver).toEqual({ jobType: TRADER, tribe: VIKING });
    expect(seated(false)?.driver).toBeUndefined();
  });

  it('ghosts through the fog with its type, tribe, heading and owner, like a building', () => {
    const store = new FogGhostStore();
    const seen = vehicle(1, { facing: HEX_SOUTH_WEST });
    const cell = '4,2';
    store.update(snapshotOf([seen]), fogViewOf(new Map([[cell, FOG_STATE.VISIBLE]]), 1));
    const ghosts = store.update(snapshotOf([]), fogViewOf(new Map([[cell, FOG_STATE.EXPLORED]]), 2));
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({
      kind: 'vehicle',
      ref: 1,
      typeId: OXCART,
      tribe: VIKING,
      facing: GFX_DIR_TO_FACING[HEX_SOUTH_WEST],
      player: PLAYER,
    });
    const [item] = buildSpriteScene(snapshotOf([]), { ghosts });
    expect(item).toMatchObject({ kind: 'vehicle', ghost: true, facing: GFX_DIR_TO_FACING[HEX_SOUTH_WEST] });
  });

  it('draws a vehicle driven out of its fogged memory into sight once, live', () => {
    // Remembered two cells west on fogged ground; the ghost list stays cached while the mask does not change.
    const ghost = { ref: 1, kind: 'vehicle', tileX: 2, tileY: 2, typeId: OXCART } as const;
    const items = buildSpriteScene(snapshotOf([vehicle(1)]), {
      ghosts: [ghost],
      fogVisible: (tileX) => tileX >= 4,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ref: 1, kind: 'vehicle' });
    expect(items[0]?.ghost).toBeUndefined();
    // Still fogged at its live spot, the memory draws instead.
    const fogged = buildSpriteScene(snapshotOf([vehicle(1)]), { ghosts: [ghost], fogVisible: () => false });
    expect(fogged).toEqual([expect.objectContaining({ ref: 1, ghost: true })]);
  });
});
