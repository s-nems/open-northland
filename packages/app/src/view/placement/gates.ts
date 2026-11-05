import {
  type Entity,
  type MooringProbe,
  type NodeGridAnswer,
  type NodeSetAnswer,
  nodeGridAccepts,
  nodeSetHas,
  type PalisadeGateProbeResult,
  type ShipWaterAnswer,
  shipWaterWorkshopsOf,
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
import type { MooringRule } from '../unit-controls/orders/berths.js';

/** The host's placement answers the overlays walk; the gates below read the same ones. */
export interface PlacementProbeViews {
  /** The held building's rule for the local seat in `tribe`, whose footprint and technology gate it
   *  takes; `techWaived` (a paper, the admin tool) skips the gate, and `owner` (the admin tool's) asks
   *  that seat's ground rule instead, past its site reach as the admin channel places. */
  readonly building: (typeId: number, tribe: number, techWaived?: boolean, owner?: number) => NodeGridProbe;
  readonly signpost: () => NodeGridProbe;
  /** The wall and road line tools' rules, which their lit washes wait on; a wall's for the seat it
   *  is laid for, whose peace ground it refuses. */
  readonly palisade: (gfxIndex: number, owner: number) => NodeGridProbe;
  readonly road: () => NodeGridProbe;
  /** The ship's mooring spots; undefined while they are being answered. */
  readonly mooring: (vehicle: number) => MooringProbe | null | undefined;
}

/** The placement rules a click decides on: each awaits the host's answer as of now. */
export interface PlacementClickGates {
  readonly askPlaceSignpostAt: (col: number, row: number) => Promise<boolean>;
  readonly askPlaceAt: (
    typeId: number,
    tribe: number,
    col: number,
    row: number,
    techWaived?: boolean,
    owner?: number,
  ) => Promise<boolean>;
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
  /** A ship's mooring rule over the shore the viewer sees, as of now. */
  readonly askMooring: (vehicle: number) => Promise<MooringRule | null>;
}

/** The placement rules the cursor ghosts and overlays read, and the click gates beside them. */
export interface PlacementGates extends PlacementClickGates {
  readonly canPlaceAt: (
    typeId: number,
    tribe: number,
    col: number,
    row: number,
    techWaived?: boolean,
    owner?: number,
  ) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  /** `canPlaceSignpostAt`, undefined while the node's answer is on its way rather than refused. */
  readonly signpostAnswerAt: (col: number, row: number) => boolean | undefined;
  /** Where `owner`'s wall may stand; with `overUpgradeGround`, on ground a building keeps for its
   *  upgrade too. */
  readonly canPlacePalisadeAt: (
    gfxIndex: number,
    owner: number,
    col: number,
    row: number,
    overUpgradeGround?: boolean,
  ) => boolean;
  /** Whether `owner`'s wall, gate or wall site stands on a node. */
  readonly palisadeBuiltAt: (owner: number, col: number, row: number) => boolean;
  /** Changes whenever `canPlacePalisadeAt` or `palisadeBuiltAt` may answer differently. */
  readonly palisadeAnswersKey: () => string;
  readonly palisadeGateProbe: (col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeGateSites: () => GateSites;
  readonly canPlaceRoadAt: (col: number, row: number, overUpgradeGround?: boolean) => boolean;
  /** Changes whenever `canPlaceRoadAt` may answer differently. */
  readonly roadAnswersKey: () => string;
  /** Whether a workshop of the type placed at the node would find ship water in its crew's yard search:
   *  `false` warns of a shop that builds no ships there, `null` says the type takes no verdict, and
   *  `undefined` while the node's answer is on its way or a new anchor waits for the read gate. An
   *  anchor asked before answers at once. */
  readonly shipWaterAt: (
    typeId: number,
    tribe: number,
    col: number,
    row: number,
    owner?: number,
  ) => boolean | null | undefined;
  readonly probes: PlacementProbeViews;
  /** {@link PlacementClickGates.askMooring}'s last answer; undefined while it is being answered. */
  readonly mooring: (vehicle: number) => MooringRule | null | undefined;
  /** Bumped when a grid or mooring answer lands or changes. */
  readonly answersVersion: () => number;
  dispose(): void;
}

/** The span's centre sits at this index of the probe's five nodes. */
const GATE_SPAN_CENTER = 2;
/** How often a selected fleet's berth preview asks its ships' mooring rules again while vehicles move. */
const MOORING_PREVIEW_REFRESH_MS = 500;
/** How long a genuinely new anchor waits before its ship-water read asks the sim: the yard sweep one
 *  answer costs runs per anchor over the ship rings, so a cursor dragged along the shore must not
 *  launch one per node it crosses. An anchor whose verdict already landed answers without the gate. */
export const SHIP_WATER_PREVIEW_REFRESH_MS = 500;
/** The anchors a session's ship-water reads asked before, so a revisit reads live. Capped: past it the
 *  set forgets, and the next visit waits for the window once, as a first one would. */
const SHIP_WATER_ASKED_CAPACITY = 512;

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
  /** The local seat's orders enter through the admin channel (the overseer), which skips the site reach. */
  trusted = false,
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
  const shipWaters = createLastAnswerCache<ShipWaterAnswer | null>({
    tick,
    same: (held, landed) => (held === null || landed === null ? held === landed : held.key === landed.key),
  });
  // The types a ship-water verdict applies to, so a held house that builds no ships asks the host
  // nothing. Content-only, fixed for the session.
  const shipWorkshops = shipWaterWorkshopsOf(host.content);
  // When the last new anchor's ship-water read launched, and the anchors it asked already (in flight
  // or landed), which read live without the gate.
  let shipWaterAskedAt = Number.NEGATIVE_INFINITY;
  const shipWaterAsked = new Set<string>();
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
  const building = (
    typeId: number,
    tribe: number,
    techWaived = false,
    standingFor?: number,
  ): NodeGridProbe => {
    // The tribe still picks the footprint of a house waived past the technology gate.
    const gated = !techWaived;
    const owner = standingFor ?? localPlayer;
    const withinReach = !trusted && standingFor === undefined;
    const family = `b${typeId}:${tribe}:${gated}:${owner}:${withinReach}`;
    // Asked every tick besides: a hostile fighter's step and a technology unlock move no blocker version.
    return gridProbe(family, () =>
      nodeGridProbe(
        grids,
        family,
        (area) => host.placementProbe(typeId, area, owner, tribe, gated, withinReach),
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
  const palisade = (gfxIndex: number, owner: number): NodeGridProbe => {
    const family = `p${gfxIndex}:${owner}`;
    return gridProbe(family, () =>
      nodeGridProbe(grids, family, (area) => host.palisadeProbe(gfxIndex, area, owner), blockerVersion),
    );
  };
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
  // The sim answers from its memo, keyed on the sea's labels, and the blocker version moves with them. It
  // moves whenever any vehicle steps, so the preview of a selected fleet asks again at most every
  // MOORING_PREVIEW_REFRESH_MS; the click asks fresh (`askMooring`).
  let mooringVersion = { at: Number.NEGATIVE_INFINITY, version: '' };
  const previewVersion = (): string => {
    const now = performance.now();
    if (now - mooringVersion.at >= MOORING_PREVIEW_REFRESH_MS)
      mooringVersion = { at: now, version: blockerVersion() };
    return mooringVersion.version;
  };
  const mooring = (vehicle: number): MooringProbe | null | undefined =>
    moorings.read(`${vehicle}`, askMooring(vehicle), previewVersion());
  // The fog rule matches the dock overlay's, so a dimmed shore in the fog takes no dock click either.
  const seenMooring = (probe: MooringProbe | null): MooringRule | null =>
    probe === null
      ? null
      : {
          key: `${probe.key}:${fogGates.revision()}`,
          moors: (col, row) => fogGates.seesNode(col, row) && probe.canMoor(col, row),
          docks: (col, row) => probe.canDock(col, row),
        };
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
    // A waiver bypasses only technology; fog, footprint and contested-ground rules still apply.
    canPlaceAt: (typeId, tribe, col, row, techWaived, owner) => {
      if (!fogGates.seesNode(col, row)) return false;
      const verdict = building(typeId, tribe, techWaived, owner).at(col, row);
      return verdict === null || verdict === true;
    },
    canPlaceSignpostAt: (col, row) => fogGates.seesNode(col, row) && signpost().at(col, row) === true,
    signpostAnswerAt: (col, row) => {
      if (!fogGates.seesNode(col, row)) return false;
      const verdict = signpost().at(col, row);
      return verdict === undefined ? undefined : verdict === true;
    },
    canPlacePalisadeAt: (gfxIndex, owner, col, row, overUpgradeGround) =>
      fogGates.seesNode(col, row) && palisade(gfxIndex, owner).at(col, row, overUpgradeGround) === true,
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
    canPlaceRoadAt: (col, row, overUpgradeGround) =>
      fogGates.seesNode(col, row) && road().at(col, row, overUpgradeGround) === true,
    roadAnswersKey: () => `${grids.version}:${fogKey()}`,
    shipWaterAt: (typeId, tribe, col, row, owner) => {
      if (!shipWorkshops.has(typeId)) return null;
      const seat = owner ?? localPlayer;
      const key = `${typeId}:${tribe}:${seat}:${col},${row}`;
      // An anchor asked before reads live, so its verdict lands and stays current without the gate;
      // only a genuinely new anchor waits for the window, so sweeping the shore costs the sim two yard
      // sweeps a second, not one per node.
      if (!shipWaterAsked.has(key)) {
        const now = performance.now();
        if (now - shipWaterAskedAt < SHIP_WATER_PREVIEW_REFRESH_MS) return undefined;
        shipWaterAskedAt = now;
        if (shipWaterAsked.size >= SHIP_WATER_ASKED_CAPACITY) shipWaterAsked.clear();
        shipWaterAsked.add(key);
      }
      return shipWaters.read(
        key,
        () => host.shipWaterProbe(typeId, tribe, col, row, seat),
        host.shipWaterVersion(),
      )?.shipWater;
    },
    askPlaceAt: (typeId, tribe, col, row, techWaived, owner) =>
      fogGates.seesNode(col, row)
        ? building(typeId, tribe, techWaived, owner)
            .freshAt(col, row)
            .then((verdict) => verdict !== false)
        : Promise.resolve(false),
    askPlaceSignpostAt: (col, row) =>
      fogGates.seesNode(col, row)
        ? host
            .signpostProbe(localPlayer, { minHx: col, maxHx: col, minHy: row, maxHy: row })
            .then((answer) => answer !== null && nodeGridAccepts(answer, col, row))
        : Promise.resolve(false),
    palisadeLineReady: async (gfxIndex, owner, anchor, reach) => {
      await Promise.all([
        ownNodes.fresh(`${owner}`, askOwnNodes(owner), blockerVersion()),
        ...areasReady(palisade(gfxIndex, owner), anchor, reach),
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
    askMooring: (vehicle) =>
      moorings.fresh(`${vehicle}`, askMooring(vehicle), blockerVersion(), true).then(seenMooring),
    mooring: (vehicle) => {
      const probe = mooring(vehicle);
      return probe === undefined ? undefined : seenMooring(probe);
    },
    answersVersion: () => grids.version + moorings.version,
    probes: {
      building,
      signpost,
      palisade,
      road,
      mooring,
    },
    dispose: () => {
      for (const cache of [grids, ownNodes, siteLists, gateProbes, moorings, shipWaters]) cache.dispose();
      shipWaterAsked.clear();
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
    highlight: [...walls].map((id) => ({ id, tone: 'candidate' })),
  };
}
