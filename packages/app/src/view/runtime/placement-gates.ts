import type { Paper, Simulation } from '@open-northland/sim';
import type { GateSites, PalisadeGateProbeView } from '../../hud/tool-panel/placement.js';
import type { FogGates } from '../projections/index.js';

/** The live placement rules the click gates and the cursor ghosts share. */
export interface PlacementGates {
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly canPlacePalisadeAt: (gfxIndex: number, col: number, row: number) => boolean;
  /** Whether `owner`'s wall, gate or wall site stands on a node. */
  readonly palisadeBuiltAt: (owner: number, col: number, row: number) => boolean;
  readonly palisadeGateProbe: (col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeGateSites: () => GateSites;
}

/** The span's centre sits at this index of the probe's five nodes. */
const GATE_SPAN_CENTER = 2;

/**
 * Click gate and cursor ghost both read these, so a ghost cannot preview what a click would refuse.
 * A mapless sim has no probe: buildings place freely, signposts never do. The fog rule is app-side
 * only (genre convention, not the original), so the ungated sim command still serves admin spawns.
 */
export function createPlacementGates(
  sim: Simulation,
  fogGates: FogGates,
  localPlayer: number,
  tribe?: number,
): PlacementGates {
  const closedGates = (sim.terrain?.landscapes?.types ?? [])
    .filter((type) => type.wall?.gate?.open === false)
    .map((type) => type.typeId);
  // Each index walks every wall, so each is kept until what it reads changes: the built nodes follow the
  // placement blockers, the gate spans the wall layout and the fog, and the hovered probe the wall layout.
  let builtKey = '';
  let builtAt: (col: number, row: number) => boolean = () => false;
  let sites: GateSites & { readonly isCenter: (col: number, row: number) => boolean } = {
    key: '',
    has: () => false,
    centerFor: () => null,
    isCenter: () => false,
    highlight: [],
  };
  let probeKey = '';
  let probe: PalisadeGateProbeView | null = null;
  const fogKey = (): string => {
    const fog = sim.fogView(localPlayer);
    return fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
  };
  const gateSites = (): typeof sites => {
    const key = `gate:${sim.palisadeLayoutVersion()}:${fogKey()}`;
    if (key !== sites.key) sites = gateSitesOf(sim, closedGates, localPlayer, fogGates, key);
    return sites;
  };
  return {
    // A paper bypasses only technology; fog, footprint and contested-ground rules still apply.
    canPlaceAt: (typeId, col, row, paper) =>
      fogGates.seesNode(col, row) &&
      (sim.placementProbe(typeId, localPlayer, paper === undefined ? tribe : undefined)?.canPlace(col, row) ??
        true),
    canPlaceSignpostAt: (col, row) =>
      fogGates.seesNode(col, row) && (sim.signpostProbe(localPlayer)?.canPlace(col, row) ?? false),
    canPlacePalisadeAt: (gfxIndex, col, row) =>
      fogGates.seesNode(col, row) && (sim.palisadeProbe(gfxIndex)?.canPlace(col, row) ?? false),
    palisadeBuiltAt: (owner, col, row) => {
      const key = `${owner}:${sim.placementBlockerVersion()}`;
      if (key !== builtKey) {
        builtAt = sim.ownPalisadeNodes(owner);
        builtKey = key;
      }
      return builtAt(col, row);
    },
    palisadeGateProbe: (col, row) => {
      if (!fogGates.seesNode(col, row)) return null;
      // Only a convertible centre reaches the probe's mover test, so only there is it re-asked each tick.
      const live = gateSites().isCenter(col, row) ? `:${sim.tick}` : '';
      const key = `${col},${row}:${sim.palisadeLayoutVersion()}${live}`;
      if (key !== probeKey) {
        probe = sim.palisadeGateProbe(col, row, closedGates, localPlayer);
        probeKey = key;
      }
      return probe;
    },
    palisadeGateSites: gateSites,
  };
}

function gateSitesOf(
  sim: Simulation,
  closedGates: readonly number[],
  localPlayer: number,
  fogGates: FogGates,
  key: string,
): GateSites & { readonly isCenter: (col: number, row: number) => boolean } {
  // Node key -> the centre of the covering span and how far along it the node sits.
  const covering = new Map<string, { col: number; row: number; distance: number }>();
  const centers = new Set<string>();
  const walls = new Set<number>();
  for (const site of sim.palisadeGateSites(closedGates, localPlayer)) {
    const center = site.span[GATE_SPAN_CENTER];
    if (center === undefined || !fogGates.seesNode(center.hx, center.hy)) continue;
    centers.add(`${center.hx},${center.hy}`);
    for (const wall of site.walls) walls.add(wall);
    site.span.forEach((node, index) => {
      const distance = Math.abs(index - GATE_SPAN_CENTER);
      const nodeKey = `${node.hx},${node.hy}`;
      const held = covering.get(nodeKey);
      if (held === undefined || distance < held.distance) {
        covering.set(nodeKey, { col: center.hx, row: center.hy, distance });
      }
    });
  }
  return {
    key,
    has: (col, row) => covering.has(`${col},${row}`),
    centerFor: (col, row) => {
      const hit = covering.get(`${col},${row}`);
      return hit === undefined ? null : { col: hit.col, row: hit.row };
    },
    isCenter: (col, row) => centers.has(`${col},${row}`),
    highlight: [...walls].map((id) => ({ id, ok: true })),
  };
}
