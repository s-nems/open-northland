import type { Command, Entity, Paper, PlayerCommand } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { PlacementStrip } from '../dom/placement-strip.js';
import type { PanelContext } from './context.js';
import {
  type ActiveLine,
  createLineTool,
  type LineNode,
  type LinePreviewNode,
  type LineTool,
} from './line-tool.js';

/** `standingWall` is the admin tool's wall line: it lays finished walls through the trusted channel. */
export type PalisadePlacementMode = 'wall' | 'gate' | 'standingWall';

/**
 * Original behavior: a wall line accepts twenty moves after its starting marker.
 *
 * Approximation: the original routes the line with a pathfinder that detours around an obstacle, where
 * this lays a straight hex line and stops at the first node the placement probe rejects.
 */
export const PALISADE_LINE_MAX_EDGES = 20;

export interface PalisadeGateProbeView {
  /** The orientation the sim picked for this node, or null when no authored row suits it. */
  readonly gfxIndex: number | null;
  readonly canConvert: boolean;
  readonly center: Entity | null;
  readonly span: readonly { readonly hx: number; readonly hy: number }[];
}

/** A set of nodes the placement wash leaves bright; `key` changes whenever the set does. */
export interface LitNodes {
  readonly key: string;
  has(col: number, row: number): boolean;
}

/** The walls a gate can go into now, lit span by span. */
export interface GateSites extends LitNodes {
  /** The centre of the lit span nearest to a node on it, or null off every span. */
  centerFor(col: number, row: number): LineNode | null;
  /** The walls on those spans, for the renderer's building tint. */
  readonly highlight: readonly { readonly id: number; readonly ok: boolean }[];
}

export interface PlacementDeps {
  readonly ctx: PanelContext;
  /** The strip that names the held building while placing. */
  readonly strip: PlacementStrip;
  /** typeId → display label for the strip. */
  readonly labelByType: ReadonlyMap<number, string>;
  /** Submit the `placeBuilding` command (the one-way seam). */
  readonly enqueue: (command: PlayerCommand) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule for the held type at a tile (`Simulation.placementProbe`); a click on
   *  a rejecting tile is inert, so build mode only ends on a placement that lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlacePalisadeAt?: (gfxIndex: number, col: number, row: number) => boolean;
  /** Whether the seat's own wall, gate or wall site already stands on a node. */
  readonly palisadeBuiltAt?: (col: number, row: number) => boolean;
  readonly palisadeGateProbe?: (gfxIndex: number, col: number, row: number) => PalisadeGateProbeView | null;
  readonly palisadeGateSites?: () => GateSites;
  /** The admin channel a standing-wall line commits through; absent, that tool lays nothing. */
  readonly enqueueTrusted?: (command: Command) => void;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
  /** A building placement was called off (Esc, the right button, a beam entry) with nothing placed;
   *  `paper` is the unspent plan it was to pay with, for the owner to take back into hand. A wall or
   *  gate tool is called off without it: the player leaves that tool to get back to the map. */
  readonly onCancel?: (paper: Paper | null) => void;
}

/** Placement mode: pick a building in the window, then one left-click on buildable ground places and
 *  exits the mode, as in the original. Esc or right-click abandons. The landing click confirms through
 *  the GUI cue; the world itself makes no sound for a new site. The wall tool lays lines (see
 *  {@link LineTool}) and stays armed until cancelled; the gate tool cuts one gate into a finished run and
 *  exits like a building. */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement. */
  activeType(): number | null;
  /** The paper paying for the active placement, or null for an ordinary construction site. */
  activePaper(): Paper | null;
  activePalisade(): number | null;
  activePalisadeMode(): PalisadePlacementMode | null;
  /** Hold `typeId` for placement; a `paper` rides the placement command and buys a finished building. */
  enter(typeId: number, paper?: Paper): void;
  /** Hold a wall or gate row; `owner` and `tribe` override the seat's for an admin standing-wall line. */
  enterPalisade(
    gfxIndex: number,
    mode: PalisadePlacementMode,
    side?: { readonly owner: number; readonly tribe: number },
  ): void;
  cancel(): void;
  /** Drop a started wall line and keep the tool; false when no line was started. */
  stepBack(): boolean;
  /** Route a left-click while placing; a rejecting or off-map tile still consumes it, so a mis-click
   *  cannot drop the mode. Returns true when consumed. */
  handleClick(clientX: number, clientY: number): boolean;
  /** The markers under the cursor: the wall line or the gate span, or null outside the palisade tools. */
  palisadePreview(tile: LineNode | null): readonly LinePreviewNode[] | null;
  /** The started wall line, for the reach wash. */
  activeLine(): ActiveLine | null;
  /** The gate tool's lit spans, for its wash; null outside the gate tool. */
  gateSites(): GateSites | null;
}

export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx, strip } = deps;

  let placementType: number | null = null;
  let placementPaper: Paper | null = null;
  let palisade: {
    readonly gfxIndex: number;
    readonly mode: PalisadePlacementMode;
    readonly line: LineTool;
  } | null = null;

  const showPalisadeStrip = (): void => {
    if (palisade === null) return;
    const copy = messages().hud;
    const hint =
      palisade.mode === 'gate'
        ? copy.construction.placeGateHint
        : palisade.line.anchor() === null
          ? copy.construction.placeWallHint
          : copy.construction.placeWallLineHint;
    const label =
      palisade.mode === 'gate'
        ? copy.gate
        : palisade.mode === 'standingWall'
          ? messages().admin.standingPalisade
          : copy.palisade;
    strip.show({ label, hint });
  };

  const exitPlacement = (): void => {
    placementType = null;
    placementPaper = null;
    palisade = null;
    strip.clear();
  };

  const wallLine = (
    gfxIndex: number,
    standing: boolean,
    side: { readonly owner: number; readonly tribe: number },
  ): LineTool =>
    createLineTool({
      tool: `palisade:${gfxIndex}`,
      maxEdges: PALISADE_LINE_MAX_EDGES,
      canPlace: (node) => deps.canPlacePalisadeAt?.(gfxIndex, node.col, node.row) === true,
      built: (node) => deps.palisadeBuiltAt?.(node.col, node.row) === true,
      commit: (nodes) => {
        for (const node of nodes) {
          const place = { kind: 'placePalisade', gfxIndex, x: node.col, y: node.row, ...side } as const;
          if (standing) deps.enqueueTrusted?.({ ...place, underConstruction: false });
          else deps.enqueue({ ...place, underConstruction: true });
        }
        ctx.cue('confirm');
      },
    });

  /** A node on a lit span stands for that span's centre, so a gate cuts in wherever its run is pointed at;
   *  the live probe there still decides, as a settler may have stepped into the opening since. */
  const gateProbeAt = (gfxIndex: number, tile: LineNode): PalisadeGateProbeView | null => {
    const at = deps.palisadeGateSites?.().centerFor(tile.col, tile.row) ?? tile;
    return deps.palisadeGateProbe?.(gfxIndex, at.col, at.row) ?? null;
  };

  /** One verdict for the whole span: the conversion takes all five walls or none. */
  const gatePreview = (gfxIndex: number, tile: LineNode): LinePreviewNode[] | null => {
    const probe = gateProbeAt(gfxIndex, tile);
    // Bare ground shows nothing; a wall off every lit span shows its refused span.
    if (probe === null || probe.center === null || probe.span.length === 0) return null;
    const state = probe.canConvert ? 'open' : 'blocked';
    return probe.span.map(({ hx, hy }) => ({ col: hx, row: hy, state }));
  };

  const convertGate = (gfxIndex: number, tile: LineNode | null): void => {
    const probe = tile === null ? null : gateProbeAt(gfxIndex, tile);
    if (probe?.canConvert !== true || probe.center === null || probe.gfxIndex === null) return;
    deps.enqueue({ kind: 'convertPalisadeGate', palisade: probe.center, gfxIndex: probe.gfxIndex });
    ctx.cue('confirm');
    exitPlacement();
  };

  return {
    isActive: () => placementType !== null || palisade !== null,
    activeType: () => placementType,
    activePaper: () => placementPaper,
    activePalisade: () => palisade?.gfxIndex ?? null,
    activePalisadeMode: () => palisade?.mode ?? null,
    enter: (typeId, paper): void => {
      placementType = typeId;
      placementPaper = paper ?? null;
      palisade = null;
      const copy = messages().hud.construction;
      strip.show({
        label: deps.labelByType.get(typeId) ?? `#${typeId}`,
        hint: paper === undefined ? copy.placeHint : copy.placePaperHint,
      });
    },
    enterPalisade: (gfxIndex, mode, side): void => {
      placementType = null;
      placementPaper = null;
      const owner = side ?? { owner: deps.owner, tribe: deps.tribe };
      palisade = { gfxIndex, mode, line: wallLine(gfxIndex, mode === 'standingWall', owner) };
      showPalisadeStrip();
    },
    cancel: (): void => {
      if (placementType === null && palisade === null) return;
      const building = placementType !== null;
      const paper = placementPaper;
      exitPlacement();
      if (building) deps.onCancel?.(paper);
    },
    stepBack: (): boolean => {
      if (palisade?.line.stepBack() !== true) return false;
      showPalisadeStrip();
      return true;
    },
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null && palisade === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (palisade !== null) {
        if (palisade.mode === 'gate') convertGate(palisade.gfxIndex, tile);
        else {
          palisade.line.click(tile);
          showPalisadeStrip();
        }
        return true;
      }
      if (
        placementType !== null &&
        tile !== null &&
        deps.canPlaceAt(
          placementType,
          tile.col,
          tile.row,
          placementPaper === null ? undefined : placementPaper,
        )
      ) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
          // The foundation stands at 0% and builders raise it, unless a paper pays for it finished.
          underConstruction: true,
          ...(placementPaper !== null ? { paper: placementPaper } : {}),
        });
        ctx.cue('confirm');
        exitPlacement();
      }
      return true;
    },
    palisadePreview: (tile): readonly LinePreviewNode[] | null => {
      if (tile === null || palisade === null) return null;
      return palisade.mode === 'gate' ? gatePreview(palisade.gfxIndex, tile) : palisade.line.preview(tile);
    },
    activeLine: () => (palisade !== null && palisade.mode !== 'gate' ? palisade.line.active() : null),
    gateSites: () => (palisade?.mode === 'gate' ? (deps.palisadeGateSites?.() ?? null) : null),
  };
}
