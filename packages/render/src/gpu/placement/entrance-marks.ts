import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { halfCellToScreen } from '../../data/projection/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import type { PlacementOverlayCell } from './overlay.js';
import { ANCHOR_RING } from './plan-stake.js';

/**
 * The entrances the road tool lights: a gold glow in a gold ring, haloed, on the ground at each door node
 * the app names, so a road can be aimed at a door. A project aid, tuned by eye. It keeps every detail
 * tier: planning a road wants the view zoomed out, and it draws only while the tool is held.
 */

/** The ring's ground ellipse, past a planned plot's outlined rim (11 x 7.5 px grown by 1.5). */
const MARK_RADIUS = { x: 17, y: 9.5 } as const;
/** A faint, wider halo round the ring, so a door still catches the eye zoomed out. */
const HALO_RADIUS = { x: 27, y: 15 } as const;
const HALO = { color: 0xffe7a0, alpha: 0.22 } as const;
const GLOW = { color: ANCHOR_RING, alpha: 0.45 } as const;
const RING = { color: ANCHOR_RING, width: 2.5, alpha: 1 } as const;
/** The ring's dark underlay, which keeps it readable on pale ground. */
const RING_SHADOW = { color: 0x000000, width: 4, alpha: 0.35 } as const;
/** Over every sprite, so a house front, a tree or a passer-by never hides a door, but under the road plan
 *  (`Number.MAX_SAFE_INTEGER`), whose plot on a door reads over the ring. */
const ENTRANCE_Z = Number.MAX_SAFE_INTEGER - 1;

/** One mark about its ground point, built once and shared by every door's instance. */
function mintMark(): GraphicsContext {
  return new GraphicsContext()
    .ellipse(0, 0, HALO_RADIUS.x, HALO_RADIUS.y)
    .fill(HALO)
    .ellipse(0, 0, MARK_RADIUS.x, MARK_RADIUS.y)
    .fill(GLOW)
    .ellipse(0, 0, MARK_RADIUS.x, MARK_RADIUS.y)
    .stroke(RING_SHADOW)
    .ellipse(0, 0, MARK_RADIUS.x, MARK_RADIUS.y)
    .stroke(RING);
}

function sameDoors(a: readonly PlacementOverlayCell[], b: readonly PlacementOverlayCell[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.col !== y.col || x.row !== y.row) return false;
  }
  return true;
}

export class EntranceMarkLayer {
  readonly container = new Container();
  private readonly mark = mintMark();
  /** One instance per door shown, kept past a smaller list for the next one: a pan only moves them. */
  private readonly instances: Graphics[] = [];
  private drawn: readonly PlacementOverlayCell[] = [];
  private drawnOn: ElevationField | null = null;

  constructor() {
    this.container.zIndex = ENTRANCE_Z;
    this.container.visible = false;
  }

  /** Mark `doors`, half-cell nodes lifted onto the ground; null or none hides the marks. The app hands a
   *  new list every tick, so it is compared by value and the marks are placed again only when it differs. */
  set(doors: readonly PlacementOverlayCell[] | null, elevation: ElevationField): void {
    if (doors === null || doors.length === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    if (this.drawnOn === elevation && sameDoors(doors, this.drawn)) return;
    doors.forEach((door, i) => {
      let instance = this.instances[i];
      if (instance === undefined) {
        instance = new Graphics(this.mark);
        this.instances.push(instance);
        this.container.addChild(instance);
      }
      const p = halfCellToScreen(door.col, door.row);
      instance.position.set(p.x, p.y - terrainLiftAtNode(elevation, door.col, door.row));
      instance.visible = true;
    });
    for (let i = doors.length; i < this.instances.length; i++) {
      const spare = this.instances[i];
      if (spare !== undefined) spare.visible = false;
    }
    this.drawn = doors;
    this.drawnOn = elevation;
  }

  /** The instances leave the shared mark alone, so it is destroyed here. */
  destroy(): void {
    this.container.destroy({ children: true });
    this.mark.destroy();
  }
}
