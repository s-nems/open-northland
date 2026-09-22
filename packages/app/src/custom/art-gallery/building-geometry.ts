import type { CustomBuildingManifest } from '@open-northland/art-contracts/custom';
import { type BuildingType, type FootprintCell, lastByTypeId } from '@open-northland/data';
import {
  CONSTRUCTION_SIGN_DX,
  type DoorBadgeRow,
  halfCellToScreen,
  SIGN_BASE_BELOW,
  SIGN_HALF_WIDTH,
  SIGN_HEIGHT,
  SIGN_STEP,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';
import type { Box } from '@open-northland/render/data';
import { buildingSignAnchorsFor, type FlagPoint, VIKING_TRIBE } from '../../content/building-gfx/index.js';
import type { ContentIr } from '../../content/ir/rows.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { workerIconNode } from '../../view/projections/index.js';

/**
 * One custom building's logic geometry as the gallery draws it: anchor node at the origin on an even
 * lattice row, offsets in world px. An odd-row placement shifts odd-`dy` cells one node right, so the door
 * alignment judged here is the even-row one.
 */
export interface BuildingGeometry {
  readonly label: string;
  readonly blocked: readonly FootprintCell[];
  readonly reserved: readonly FootprintCell[];
  readonly door: FootprintCell;
  /** The sign post's base in world px from the anchor: the extracted `GfxFlagPoint`, else the derived
   *  worker-icon node the map falls back to. */
  readonly post: FlagPoint;
  /** A representative badge chain for the post: one family banner on a home, a crew on any other type. */
  readonly signRows: readonly DoorBadgeRow[];
  /** False without local content, which leaves the cells empty and the door at the manifest's node. */
  readonly fromContent: boolean;
}

const HOME_ROWS: readonly DoorBadgeRow[] = [{ role: 'family' }];
const CREW_ROWS: readonly DoorBadgeRow[] = [
  { role: 'craftsman' },
  { role: 'craftsman' },
  { role: 'carrier' },
];

/** The tribes whose bodies and anchors the gallery resolves: every tribe a custom package names, base first. */
export function galleryBuildingTribes(manifests: readonly { readonly tribeId: number }[]): WorldTribes {
  const others = [...new Set(manifests.map((m) => m.tribeId))]
    .filter((t) => t !== VIKING_TRIBE)
    .sort((a, b) => a - b);
  return [VIKING_TRIBE, ...others];
}

/** `buildings` are the sim's own rows, so the door drawn is the one settlers walk to; the IR only supplies
 *  the per-skin sign anchors. */
export function buildingGeometryIndex(
  buildings: readonly BuildingType[],
  ir: ContentIr | null,
  tribes: WorldTribes,
): (manifest: CustomBuildingManifest) => BuildingGeometry {
  const rows = lastByTypeId(buildings);
  const anchorsOf = buildingSignAnchorsFor(ir, tribes);
  return (manifest) => {
    const row = rows.get(manifest.typeId);
    const footprint = row?.footprint;
    const door = footprint?.door ?? { dx: manifest.doorNode.x, dy: manifest.doorNode.y };
    const iconNode = workerIconNode({ door }, { hx: 0, hy: 0 }, row?.id);
    return {
      label: row?.id ?? `#${manifest.typeId}`,
      blocked: footprint?.blocked ?? [],
      reserved: footprint?.reserved ?? [],
      door,
      post:
        anchorsOf(manifest.typeId, manifest.tribeId).flagPoint ?? halfCellToScreen(iconNode.hx, iconNode.hy),
      signRows: row?.kind === 'home' ? HOME_ROWS : CREW_ROWS,
      fromContent: footprint !== undefined,
    };
  };
}

/** The world-px box the overlay draws into: every cell diamond plus the sign chain and construction stand. */
export function geometryBounds(geometry: BuildingGeometry): Box {
  let box: Box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const include = (x: number, y: number, halfW: number, up: number, down: number): void => {
    box = unionBox(box, { minX: x - halfW, minY: y - up, maxX: x + halfW, maxY: y + down });
  };
  for (const cell of [...geometry.reserved, ...geometry.blocked, geometry.door]) {
    const p = halfCellToScreen(cell.dx, cell.dy);
    include(p.x, p.y, TILE_HALF_W / 2, TILE_HALF_H / 4, TILE_HALF_H / 4);
  }
  const chain = (geometry.signRows.length - 1) * SIGN_STEP + SIGN_HEIGHT;
  include(geometry.post.x, geometry.post.y, SIGN_HALF_WIDTH, chain, SIGN_BASE_BELOW);
  include(
    geometry.post.x + CONSTRUCTION_SIGN_DX,
    geometry.post.y,
    SIGN_HALF_WIDTH,
    SIGN_HEIGHT,
    SIGN_BASE_BELOW,
  );
  return box;
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
