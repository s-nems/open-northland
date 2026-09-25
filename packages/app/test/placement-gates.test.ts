import {
  cellAnchorNode,
  components,
  type Entity,
  FOG_MODE,
  FOG_STATE,
  type FogView,
  halfCellMapFromCells,
  Simulation,
} from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../src/catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_HOME_00,
  resolveWorldContent,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../src/game/sandbox/index.js';
import { sandboxPalisadeTypes } from '../src/game/sandbox/palisades.js';
import { makeOverlayFrameSource } from '../src/view/placement-overlay.js';
import { createFogGates } from '../src/view/projections/index.js';
import { createPlacementGates, type PlacementGates } from '../src/view/runtime/placement-gates.js';

const MAP_W = 24;
const MAP_H = 12;
const VIKING = 1;
/** The enemy swordsman's cell, and a site two cells off him against one across the map. */
const RAIDER = { x: 6, y: 4 };
const NEAR = cellAnchorNode(8, 4);
const FAR = cellAnchorNode(18, 8);

function openField(): { sim: Simulation; gates: PlacementGates; fog: ReturnType<typeof createFogGates> } {
  const terrain = grassTerrain(MAP_W, MAP_H);
  const sim = new Simulation({
    seed: 1,
    content: resolveWorldContent(terrain, {}),
    map: { ...halfCellMapFromCells(terrain), landscapes: { types: sandboxPalisadeTypes(), placements: [] } },
  });
  const fog = createFogGates();
  fog.setFrame(null); // fog off: only the placement rules decide
  return { sim, gates: createPlacementGates(sim, fog, HUMAN_PLAYER), fog };
}

describe('placement gates - the ground an enemy army contests', () => {
  it('refuses the click and the ghost beside an enemy soldier, and admits them again once he is gone', () => {
    const { sim, gates } = openField();
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(true);
    expect(gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy)).toBe(true);

    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, RAIDER.x, RAIDER.y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
    });
    sim.step();
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(false);
    expect(gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy)).toBe(true);

    for (const e of [...sim.world.query(components.Settler)]) sim.world.destroy(e);
    expect(gates.canPlaceAt(BUILDING_HOME_00, NEAR.hx, NEAR.hy)).toBe(true);
  });

  it('omits only the technology tribe from a paper-paid probe', () => {
    const { sim, fog } = openField();
    const gates = createPlacementGates(sim, fog, HUMAN_PLAYER, VIKING);
    const probe = vi.spyOn(sim, 'placementProbe');
    const paper = { kind: 'placeAny', param: 0 } as const;

    gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy);
    gates.canPlaceAt(BUILDING_HOME_00, FAR.hx, FAR.hy, paper);

    expect(probe.mock.calls).toEqual([
      [BUILDING_HOME_00, HUMAN_PLAYER, VIKING],
      [BUILDING_HOME_00, HUMAN_PLAYER, undefined],
    ]);
  });

  it('probes authored closed-gate rows at the hovered wall node', () => {
    const { sim, gates } = openField();
    const gate = sim.terrain?.landscapes?.types.find((type) => type.wall?.gate?.open === false);
    expect(gate).toBeDefined();
    if (gate === undefined) return;
    const probe = vi.spyOn(sim, 'palisadeGateProbe').mockReturnValue({
      canConvert: false,
      gfxIndex: gate.typeId,
      center: null,
      axis: null,
      remove: [],
      walls: [],
      span: [{ hx: 8, hy: 6 }],
    });

    expect(gates.palisadeGateProbe(8, 6)).toMatchObject({
      gfxIndex: gate.typeId,
      canConvert: false,
      span: [{ hx: 8, hy: 6 }],
    });
    // Every authored orientation is offered in one call, so the probe builds its node index once.
    const orientations = (sim.terrain?.landscapes?.types ?? [])
      .filter((type) => type.wall?.gate?.open === false)
      .map((type) => type.typeId);
    expect(probe).toHaveBeenCalledWith(8, 6, orientations, HUMAN_PLAYER);
  });

  it('asks the hovered gate probe once per wall layout, and once per tick only on a convertible centre', () => {
    const { sim, gates } = openField();
    const probe = vi.spyOn(sim, 'palisadeGateProbe').mockReturnValue({
      canConvert: false,
      gfxIndex: null,
      center: null,
      axis: null,
      remove: [],
      walls: [],
      span: [],
    });
    vi.spyOn(sim, 'palisadeGateSites').mockReturnValue([
      {
        canConvert: true,
        gfxIndex: 697,
        center: 3 as Entity,
        axis: 0,
        remove: [],
        walls: [1, 2, 3, 4, 5] as Entity[],
        span: [4, 5, 6, 7, 8].map((hx) => ({ hx, hy: 6 })),
      },
    ]);

    // Bare ground: the answer follows the wall layout alone, so neither a second frame nor a tick asks again.
    gates.palisadeGateProbe(12, 2);
    gates.palisadeGateProbe(12, 2);
    sim.step();
    gates.palisadeGateProbe(12, 2);
    expect(probe).toHaveBeenCalledTimes(1);

    // A convertible centre: a mover may step into the opening on any tick, so each tick asks once.
    gates.palisadeGateProbe(6, 6);
    gates.palisadeGateProbe(6, 6);
    expect(probe).toHaveBeenCalledTimes(2);
    sim.step();
    gates.palisadeGateProbe(6, 6);
    expect(probe).toHaveBeenCalledTimes(3);

    vi.spyOn(sim, 'palisadeLayoutVersion').mockReturnValue('next');
    gates.palisadeGateProbe(12, 2);
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("tests the built nodes of the owner a line is laid for, not the seat's", () => {
    const { sim, gates } = openField();
    const own = vi
      .spyOn(sim, 'ownPalisadeNodes')
      .mockImplementation((player) => () => player === ENEMY_PLAYER);
    expect(gates.palisadeBuiltAt(ENEMY_PLAYER, 4, 2)).toBe(true);
    expect(gates.palisadeBuiltAt(HUMAN_PLAYER, 4, 2)).toBe(false);
    expect(gates.palisadeBuiltAt(HUMAN_PLAYER, 5, 2)).toBe(false);
    expect(own.mock.calls).toEqual([[ENEMY_PLAYER], [HUMAN_PLAYER]]);
  });

  it('indexes the gate spans once per wall layout and aims each node at its nearest centre', () => {
    const { sim, gates } = openField();
    const site = (center: number, walls: readonly number[]) => ({
      canConvert: true,
      gfxIndex: 697,
      center: walls[2] as Entity,
      axis: 0 as const,
      remove: [],
      walls: walls as Entity[],
      span: [-2, -1, 0, 1, 2].map((offset) => ({ hx: center + offset, hy: 6 })),
    });
    // Two centres of one run of six: node 5 lies nearer centre 6, node 8 nearer centre 7.
    const probe = vi
      .spyOn(sim, 'palisadeGateSites')
      .mockReturnValue([site(6, [1, 2, 3, 4, 5]), site(7, [2, 3, 4, 5, 6])]);

    const sites = gates.palisadeGateSites();
    expect(sites.has(4, 6)).toBe(true);
    expect(sites.has(10, 6)).toBe(false);
    expect(sites.centerFor(5, 6)).toEqual({ col: 6, row: 6 });
    expect(sites.centerFor(8, 6)).toEqual({ col: 7, row: 6 });
    expect(sites.centerFor(10, 6)).toBeNull();
    expect(sites.highlight.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(gates.palisadeGateSites()).toBe(sites);
    expect(probe).toHaveBeenCalledTimes(1);

    vi.spyOn(sim, 'palisadeLayoutVersion').mockReturnValue('next');
    expect(gates.palisadeGateSites()).not.toBe(sites);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('leaves a gate span unlit while its centre is fogged', () => {
    const { sim, gates, fog } = openField();
    vi.spyOn(sim, 'palisadeGateSites').mockReturnValue([
      {
        canConvert: true,
        gfxIndex: 697,
        center: 3 as Entity,
        axis: 0,
        remove: [],
        walls: [1, 2, 3, 4, 5] as Entity[],
        span: [4, 5, 6, 7, 8].map((hx) => ({ hx, hy: 6 })),
      },
    ]);
    const hidden: FogView = {
      player: HUMAN_PLAYER,
      mode: FOG_MODE.CLASSIC,
      cellsWide: MAP_W,
      cellsHigh: MAP_H,
      generation: 1,
      stateAt: () => FOG_STATE.UNEXPLORED,
    };
    fog.setFrame(hidden);
    vi.spyOn(sim, 'fogView').mockReturnValue(hidden);
    const sites = gates.palisadeGateSites();
    expect(sites.has(6, 6)).toBe(false);
    expect(sites.highlight).toEqual([]);
  });

  it('uses the same paper technology bypass for the bright buildable-ground overlay', () => {
    const { sim } = openField();
    const overlay = makeOverlayFrameSource(sim, { width: MAP_W, height: MAP_H }, HUMAN_PLAYER, VIKING);
    const probe = vi.spyOn(sim, 'placementProbe');
    const camera = { offsetX: 0, offsetY: 0, scale: 1 };
    const paper = { kind: 'placeHouse', param: BUILDING_HOME_00 } as const;

    overlay(BUILDING_HOME_00, camera, 320, 200);
    overlay(BUILDING_HOME_00, camera, 320, 200, paper);

    expect(probe.mock.calls).toEqual([
      [BUILDING_HOME_00, HUMAN_PLAYER, VIKING],
      [BUILDING_HOME_00, HUMAN_PLAYER, undefined],
    ]);
  });
});
