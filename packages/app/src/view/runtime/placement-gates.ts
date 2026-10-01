import {
  type Entity,
  type MooringProbe,
  type NodeGridAnswer,
  type NodeSetAnswer,
  nodeSetHas,
  type PalisadeGateProbeResult,
  type Paper,
} from '@open-northland/sim';
import type { GateSites, PalisadeGateProbeView } from '../../hud/tool-panel/placement.js';
import {
  createLastAnswerCache,
  mooringProbeOf,
  type NodeGridProbe,
  nodeGridProbe,
  PROBE_AREA_NODES,
  type SessionHost,
  sameGridAnswer,
  sameMooring,
  sameNodeSet,
  samePlainData,
} from '../../session/index.js';
import type { FogGates } from '../projections/index.js';

/** The host's placement answers the overlays walk; the gates below read the same ones. */
export interface PlacementProbeViews {
  /** The held building's rule for the local seat; a paper waives the seat's technology gate. */
  readonly building: (typeId: number, paper?: Paper) => NodeGridProbe;
  readonly signpost: () => NodeGridProbe;
  /** The wall and road line tools' rules, which their lit washes wait on. */
  readonly palisade: (gfxIndex: number) => NodeGridProbe;
  readonly road: () => NodeGridProbe;
  /** The ship's mooring spots; undefined while they are being answered. */
  readonly mooring: (vehicle: number) => MooringProbe | null | undefined;
}

/** The placement rules a click decides on: each awaits the host's answer as of now. */
export interface PlacementClickGates {
  readonly askPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => Promise<boolean>;
  /** Brings the wall answers within `reach` nodes of a line's anchor, and `owner`'s built nodes, up to
   *  now, so a line decided right after reads current answers through the synchronous rules. */
  readonly palisadeLineReady: (
    gfxIndex: number,
    owner: number,
    anchor: { readonly col: number; readonly row: number },
    reach: number,
  ) => Promise<void>;
  /** Brings the road answers within `reach` nodes of a line's anchor up to now, like
   *  {@link palisadeLineReady}. */
  readonly roadLineReady: (
    anchor: { readonly col: number; readonly row: number },
    reach: number,
  ) => Promise<void>;
  /** The gate conversion a click at a node would make, its span centre resolved as the preview does. */
  readonly askPalisadeGate: (col: number, row: number) => Promise<PalisadeGateProbeView | null>;
  readonly askMoorAt: (vehicle: number, col: number, row: number) => Promise<boolean>;
}

/** The placement rules the cursor ghosts and overlays read, and the click gates beside them. */
export interface PlacementGates extends PlacementClickGates {
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly canPlacePalisadeAt: (gfxIndex: number, col: number, row: number) => boolean;
  /** Whether `owner`'s wall, gate or wall site stands on a node. */
  readonly palisadeBuiltAt: (owner: number, col: number, row: number) => boolean;
  /** Changes whenever `canPlacePalisadeAt` or `palisadeBuiltAt` may answer differently. */
  readonly palisadeAnswersKey: () => string;
  readonly palisadeGateProbe: (col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeGateSites: () => GateSites;
  readonly canPlaceRoadAt: (col: number, row: number) => boolean;
  /** Changes whenever `canPlaceRoadAt` may answer differently. */
  readonly roadAnswersKey: () => string;
  readonly probes: PlacementProbeViews;
  dispose(): void;
}

/** The span's centre sits at this index of the probe's five nodes. */
const GATE_SPAN_CENTER = 2;

type IndexedGateSites = GateSites & { readonly isCenter: (col: number, row: number) => boolean };

const NO_GATE_SITES: readonly PalisadeGateProbeResult[] = [];

/**
 * Click gate and cursor ghost both read these, so a ghost cannot preview what a click would refuse.
 * A mapless world has no probe: buildings place freely, signposts never do. The fog rule is app-side
 * only (genre convention, not the original), so the ungated sim command still serves admin spawns.
 * The synchronous rules read the host's last answer and refuse a node whose answer is still on its way;
 * the `ask*` rules a click decides on await the host.
 */
export function createPlacementGates(
  host: SessionHost,
  fogGates: FogGates,
  localPlayer: number,
  tribe?: number,
): PlacementGates {
  const closedGates = host.landscapeTypes
    .filter((type) => type.wall?.gate?.open === false)
    .map((type) => type.typeId);
  const tick = (): number => host.tick;
  const grids = createLastAnswerCache<NodeGridAnswer | null>({ tick, same: sameGridAnswer });
  const ownNodes = createLastAnswerCache<NodeSetAnswer>({ tick, same: sameNodeSet });
  const siteLists = createLastAnswerCache<readonly PalisadeGateProbeResult[]>({ tick, same: samePlainData });
  const gateProbes = createLastAnswerCache<PalisadeGateProbeResult | null>({ tick, same: samePlainData });
  const moorings = createLastAnswerCache<MooringProbe | null>({ tick, same: sameMooring });
  const blockerVersion = (): string => host.placementBlockerVersion();

  const gridProbes = new Map<string, NodeGridProbe>();
  const gridProbe = (family: string, make: () => NodeGridProbe): NodeGridProbe => {
    let probe = gridProbes.get(family);
    if (probe === undefined) {
      probe = make();
      gridProbes.set(family, probe);
    }
    return probe;
  };
  const building = (typeId: number, paper?: Paper): NodeGridProbe => {
    // A placing paper authorizes the house past the technology gate; the tribe still picks its footprint.
    const gated = paper === undefined;
    const family = `b${typeId}:${gated}`;
    // Asked every tick besides: a hostile fighter's step and a technology unlock move no blocker version.
    return gridProbe(family, () =>
      nodeGridProbe(
        grids,
        family,
        (area) => host.placementProbe(typeId, area, localPlayer, tribe, gated),
        blockerVersion,
        true,
      ),
    );
  };
  const signpost = (): NodeGridProbe =>
    gridProbe('s', () =>
      nodeGridProbe(
        grids,
        's',
        (area) => host.signpostProbe(localPlayer, area),
        () => host.signpostBlockerVersion(),
      ),
    );
  const palisade = (gfxIndex: number): NodeGridProbe =>
    gridProbe(`p${gfxIndex}`, () =>
      nodeGridProbe(grids, `p${gfxIndex}`, (area) => host.palisadeProbe(gfxIndex, area), blockerVersion),
    );
  const road = (): NodeGridProbe =>
    gridProbe('r', () =>
      nodeGridProbe(
        grids,
        'r',
        (area) => host.roadSiteProbe(area),
        () => host.roadSitePlacementVersion(),
      ),
    );
  /** Brings `probe`'s areas within `reach` nodes of `anchor` up to now. */
  const areasReady = (
    probe: NodeGridProbe,
    anchor: { readonly col: number; readonly row: number },
    reach: number,
  ): Promise<unknown>[] => {
    const asked: Promise<unknown>[] = [];
    const first = (node: number): number => Math.floor((node - reach) / PROBE_AREA_NODES);
    const last = (node: number): number => Math.floor((node + reach) / PROBE_AREA_NODES);
    for (let ay = first(anchor.row); ay <= last(anchor.row); ay++) {
      for (let ax = first(anchor.col); ax <= last(anchor.col); ax++) {
        asked.push(probe.freshAt(ax * PROBE_AREA_NODES, ay * PROBE_AREA_NODES));
      }
    }
    return asked;
  };
  const askMooring = (vehicle: number) => (): Promise<MooringProbe | null> =>
    host.mooringProbe(vehicle as Entity).then((answer) => (answer === null ? null : mooringProbeOf(answer)));
  // The sim answers from its memo, keyed on the sea's labels, and the blocker version moves with them.
  const mooring = (vehicle: number): MooringProbe | null | undefined =>
    moorings.read(`${vehicle}`, askMooring(vehicle), blockerVersion());
  const askOwnNodes = (owner: number) => (): Promise<NodeSetAnswer> => host.ownPalisadeNodes(owner);
  const askSites = (): Promise<readonly PalisadeGateProbeResult[]> =>
    host.palisadeGateSites(closedGates, localPlayer);
  const askGateProbe = (col: number, row: number) => (): Promise<PalisadeGateProbeResult | null> =>
    host.palisadeGateProbe(col, row, closedGates, localPlayer);

  // The gate spans are indexed once per wall layout, fog and landed answer.
  let sites: IndexedGateSites = {
    key: '',
    has: () => false,
    centerFor: () => null,
    isCenter: () => false,
    highlight: [],
  };
  const fogKey = (): string => {
    const fog = host.fogView(localPlayer);
    return fog === null ? 'off' : `${fog.mode}:${fog.generation}`;
  };
  const gateSites = (): IndexedGateSites => {
    const layout = host.palisadeLayoutVersion();
    const listed = siteLists.read('sites', askSites, layout) ?? NO_GATE_SITES;
    const key = `gate:${layout}:${fogKey()}:${siteLists.version}`;
    if (key !== sites.key) sites = gateSitesOf(listed, fogGates, key);
    return sites;
  };
  return {
    // A paper bypasses only technology; fog, footprint and contested-ground rules still apply.
    canPlaceAt: (typeId, col, row, paper) => {
      if (!fogGates.seesNode(col, row)) return false;
      const verdict = building(typeId, paper).at(col, row);
      return verdict === null || verdict === true;
    },
    canPlaceSignpostAt: (col, row) => fogGates.seesNode(col, row) && signpost().at(col, row) === true,
    canPlacePalisadeAt: (gfxIndex, col, row) =>
      fogGates.seesNode(col, row) && palisade(gfxIndex).at(col, row) === true,
    palisadeBuiltAt: (owner, col, row) => {
      const built = ownNodes.read(`${owner}`, askOwnNodes(owner), blockerVersion());
      return built !== undefined && nodeSetHas(built, col, row);
    },
    palisadeAnswersKey: () => `${blockerVersion()}:${grids.version}:${ownNodes.version}:${fogKey()}`,
    palisadeGateProbe: (col, row) => {
      if (!fogGates.seesNode(col, row)) return null;
      // Only a convertible centre reaches the probe's mover test, so only there is it re-asked each tick.
      const live = gateSites().isCenter(col, row);
      return (
        gateProbes.read(`${col},${row}`, askGateProbe(col, row), host.palisadeLayoutVersion(), live) ?? null
      );
    },
    palisadeGateSites: gateSites,
    canPlaceRoadAt: (col, row) => fogGates.seesNode(col, row) && road().at(col, row) === true,
    roadAnswersKey: () => `${grids.version}:${fogKey()}`,
    askPlaceAt: (typeId, col, row, paper) =>
      fogGates.seesNode(col, row)
        ? building(typeId, paper)
            .freshAt(col, row)
            .then((verdict) => verdict !== false)
        : Promise.resolve(false),
    palisadeLineReady: async (gfxIndex, owner, anchor, reach) => {
      await Promise.all([
        ownNodes.fresh(`${owner}`, askOwnNodes(owner), blockerVersion()),
        ...areasReady(palisade(gfxIndex), anchor, reach),
      ]);
    },
    roadLineReady: async (anchor, reach) => {
      await Promise.all(areasReady(road(), anchor, reach));
    },
    askPalisadeGate: async (col, row) => {
      const layout = host.palisadeLayoutVersion();
      const listed = await siteLists.fresh('sites', askSites, layout);
      const at = gateSitesOf(listed, fogGates, layout).centerFor(col, row) ?? { col, row };
      if (!fogGates.seesNode(at.col, at.row)) return null;
      return gateProbes.fresh(`${at.col},${at.row}`, askGateProbe(at.col, at.row), layout, true);
    },
    askMoorAt: (vehicle, col, row) =>
      fogGates.seesNode(col, row)
        ? moorings
            .fresh(`${vehicle}`, askMooring(vehicle), blockerVersion(), true)
            .then((probe) => probe?.canMoor(col, row) === true)
        : Promise.resolve(false),
    probes: {
      building,
      signpost,
      palisade,
      road,
      mooring,
    },
    dispose: () => {
      for (const cache of [grids, ownNodes, siteLists, gateProbes, moorings]) cache.dispose();
    },
  };
}

function gateSitesOf(
  listed: readonly PalisadeGateProbeResult[],
  fogGates: FogGates,
  key: string,
): IndexedGateSites {
  // Node key -> the centre of the covering span and how far along it the node sits.
  const covering = new Map<string, { col: number; row: number; distance: number }>();
  const centers = new Set<string>();
  const walls = new Set<number>();
  for (const site of listed) {
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
