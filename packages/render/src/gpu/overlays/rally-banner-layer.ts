import { Container, Graphics, MeshPlane, Rectangle, Sprite, Texture } from 'pixi.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { markMagnifiedTexture } from '../pixel-art/registry.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * A barracks' rally point on the world view: a war banner on a pole, its cloth in the owner's colour and
 * swaying from the arm it hangs on. It stands over every sprite, so the soldiers gathered on the post
 * never hide it. A presentation addition, not taken from the original. The app owns the clock.
 * Extents in art px at zoom 1; authored.
 */

export interface RallyBanner {
  /** Stable while the banner shows, the retained-pool key: the flag entity, or a cursor preview's own id. */
  readonly id: number;
  /** The half-cell node the banner stands on. */
  readonly hx: number;
  readonly hy: number;
  readonly colour: number;
  /** The banner the cursor carries before the click plants it: drawn faint. */
  readonly preview?: boolean | undefined;
}

/** The art page holds three cells side by side, each in a transparent gutter: the pole and its arm, the
 *  cloth's trim and emblem, and the cloth itself in grey for tinting. */
const CELLS = 3;
const GUTTER = 2;
/** The pole's foot inside a cell, which stands on the node: px from the cell's left edge. */
const POLE_FOOT_X = 4;
/** The row the cloth hangs from, in px from the cell's top; the cloth above it holds still. */
const HANG_ROW = 14;

/** The cloth's sway: its hem swings this many px either way, a wave running down the cloth. */
const SWAY_PX = 2.2;
const SWAY_SECONDS_PER_RADIAN = 0.26;
/** Radians of phase between the hang row and the hem, so the cloth bends instead of swinging stiff. */
const SWAY_PHASE_SPAN = 2.4;
/** Mesh rows down the cell: enough for the bend to read at the art's height. */
const CLOTH_ROWS = 10;
const CLOTH_COLUMNS = 2;

const PREVIEW_ALPHA = 0.6;

/** The stand-in drawn when the art failed to load: a pole with a pennant of the owner's colour. */
const STAND_IN_HEIGHT = 44;
const STAND_IN_PENNANT = { width: 18, height: 12 } as const;
const POLE_COLOUR = 0x6b4a2b;
const OUTLINE = 0x1a120a;
const OUTLINE_WIDTH = 1.5;

interface BannerArt {
  readonly pole: Texture;
  readonly trim: Texture;
  readonly cloth: Texture;
}

function splitBannerArt(page: Texture): BannerArt {
  const width = page.frame.width / CELLS;
  const cell = (index: number): Texture => {
    const texture = new Texture({
      source: page.source,
      frame: new Rectangle(page.frame.x + index * width, page.frame.y, width, page.frame.height),
    });
    markMagnifiedTexture(texture);
    return texture;
  };
  return { pole: cell(0), trim: cell(1), cloth: cell(2) };
}

interface BannerNode {
  readonly root: Container;
  /** The cloth's meshes with their rest x per vertex; empty for the stand-in. */
  readonly cloths: readonly { readonly mesh: MeshPlane; readonly restX: Float32Array }[];
}

function clothMesh(texture: Texture, tint: number): BannerNode['cloths'][number] {
  const mesh = new MeshPlane({ texture, verticesX: CLOTH_COLUMNS, verticesY: CLOTH_ROWS });
  mesh.tint = tint;
  return { mesh, restX: mesh.geometry.positions.filter((_, index) => index % 2 === 0) };
}

function standIn(colour: number): Graphics {
  const { width, height } = STAND_IN_PENNANT;
  return new Graphics()
    .moveTo(0, 0)
    .lineTo(0, -STAND_IN_HEIGHT)
    .stroke({ width: 2 * OUTLINE_WIDTH, color: POLE_COLOUR })
    .poly([0, -STAND_IN_HEIGHT, width, -STAND_IN_HEIGHT + height / 2, 0, -STAND_IN_HEIGHT + height])
    .fill({ color: colour })
    .stroke({ width: OUTLINE_WIDTH, color: OUTLINE, join: 'round' });
}

function makeNode(banner: RallyBanner, art: BannerArt | undefined): BannerNode {
  const root = new Container();
  if (banner.preview === true) root.alpha = PREVIEW_ALPHA;
  if (art === undefined) {
    root.addChild(standIn(banner.colour));
    return { root, cloths: [] };
  }
  // The cell's origin, placed so the pole's foot sits on the node.
  const body = new Container();
  body.position.set(-POLE_FOOT_X, GUTTER - art.pole.frame.height);
  const cloths = [clothMesh(art.cloth, banner.colour), clothMesh(art.trim, 0xffffff)];
  body.addChild(new Sprite(art.pole), ...cloths.map((cloth) => cloth.mesh));
  root.addChild(body);
  return { root, cloths };
}

/** Bend the cloth for wall-clock `seconds`: every mesh row below the hang row shifts sideways, further toward the hem. */
function sway(node: BannerNode, seconds: number): void {
  for (const { mesh, restX } of node.cloths) {
    const positions = mesh.geometry.positions;
    const height = mesh.texture.frame.height;
    for (let vertex = 0; vertex < restX.length; vertex++) {
      const y = positions[2 * vertex + 1] ?? 0;
      const hang = Math.max(0, (y - HANG_ROW) / (height - HANG_ROW));
      const shift = SWAY_PX * hang * Math.sin(seconds / SWAY_SECONDS_PER_RADIAN - hang * SWAY_PHASE_SPAN);
      positions[2 * vertex] = (restX[vertex] ?? 0) + shift;
    }
    mesh.geometry.getBuffer('aPosition').update();
  }
}

export class RallyBannerLayer {
  readonly container = new Container();
  private readonly nodes = new Map<number, BannerNode>();
  private readonly seen = new Set<number>();
  private readonly art: BannerArt | undefined;

  /** `page` is the banner art's page; absent draws a flat stand-in. */
  constructor(page?: Texture) {
    this.art = page === undefined ? undefined : splitBannerArt(page);
  }

  draw(
    banners: readonly RallyBanner[],
    elevation: ElevationField,
    viewport: Viewport,
    seconds: number,
  ): void {
    this.seen.clear();
    for (const banner of banners) {
      const spot = projectNode(elevation, banner.hx, banner.hy);
      if (!isVisible(viewport, spot.x, spot.y)) continue;
      let node = this.nodes.get(banner.id);
      if (node === undefined) {
        node = makeNode(banner, this.art);
        this.container.addChild(node.root);
        this.nodes.set(banner.id, node);
      }
      node.root.position.set(spot.x, spot.y);
      sway(node, seconds);
      this.seen.add(banner.id);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.root.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.art?.pole.destroy();
    this.art?.trim.destroy();
    this.art?.cloth.destroy();
    this.nodes.clear();
  }
}
