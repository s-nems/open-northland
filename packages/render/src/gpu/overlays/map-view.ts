import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { type Application, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { type Camera, cameraViewport, ONE, type Viewport } from '../../data/projection/index.js';
import { readPosition } from '../../data/snapshot/index.js';
import { type ElevationField, projectNode, projectTile } from '../../data/terrain/index.js';
import type { SpritePool } from '../sprite-pool/index.js';
import { renderFramedWorld } from './framed-world-render.js';

/** What a map view looks at: a half-cell node, or an entity's feet. */
export type MapViewTarget =
  | { readonly kind: 'node'; readonly hx: number; readonly hy: number }
  | { readonly kind: 'entity'; readonly ref: number };

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One map view a window draws (the briefing's `<usericon:…>` pictures): the world at `scale` screen px
 * per world px, with the target point at (`focusX`, `focusY`) screen px from `box`'s top-left, painted
 * into `clip`, the part of the box the window shows. With `soloFill` the target entity draws alone over
 * that `0xRRGGBB` fill.
 */
export interface MapViewFrame {
  readonly box: ScreenRect;
  readonly clip: ScreenRect;
  readonly target: MapViewTarget;
  readonly focusX: number;
  readonly focusY: number;
  readonly scale: number;
  readonly soloFill?: number;
}

/** The retained world layers a view re-culls to its own camera, and the main frame's culls it restores. */
export interface MapViewWorld {
  cullTo(camera: Camera, w: number, h: number): void;
  restore(): void;
  /** Opaque ground colour (`0xRRGGBB`) a view floors its off-map margin with. */
  readonly backdrop: number;
}

/** The main frame's state a view pass reads. */
export interface MapViewScene {
  readonly snapshot: WorldSnapshot;
  readonly tick: number;
  readonly alpha: number;
  readonly elevation: ElevationField;
  readonly staticRefs?: ReadonlySet<number>;
  readonly main: { readonly camera: Camera; readonly width: number; readonly height: number };
  /** The pre-lift margin a sprite cull box needs around the drawn area. */
  readonly spriteMargin: number;
}

/**
 * Renders the map views after the main stage render, overpainting each clip region like the details
 * portrait (`portrait-inset.ts`): `worldLayer` re-aimed at the target, the retained layers re-culled to
 * the view, and the pool's culled entities borrowed for it. The original's view display clears the
 * exploration draw flag (`an original routine(4, false)` in the `CMissionInfoWindow` constructor), so the
 * view ignores the fog.
 */
export class MapViewLayer {
  private views: readonly MapViewFrame[] = [];
  /** The fill quad under the world, parented into it only for a pass. */
  private readonly floor = new Sprite(Texture.WHITE);

  constructor(
    private readonly app: Application,
    private readonly worldLayer: Container,
    private readonly pool: SpritePool,
  ) {}

  set(views: readonly MapViewFrame[]): void {
    this.views = views;
  }

  draw(scene: MapViewScene, world: MapViewWorld): void {
    for (const view of this.views) this.drawView(view, scene, world);
  }

  private drawView(view: MapViewFrame, scene: MapViewScene, world: MapViewWorld): void {
    // A scrolling window places its boxes at fractional px; the render frame takes whole ones.
    const x = Math.round(view.clip.x);
    const y = Math.round(view.clip.y);
    const w = Math.round(view.clip.w);
    const h = Math.round(view.clip.h);
    if (w < 1 || h < 1) return;
    const point = targetPoint(view.target, scene.snapshot, scene.elevation);
    if (point === null) return;
    const { scale } = view;
    const camera: Camera = {
      offsetX: view.box.x + view.focusX - x - point.x * scale,
      offsetY: view.box.y + view.focusY - y - point.y * scale,
      scale,
    };
    const viewport: Viewport = cameraViewport(camera, w, h, scene.spriteMargin);
    const solo = view.soloFill !== undefined && view.target.kind === 'entity' ? view.target.ref : undefined;
    try {
      // A solo card draws its subject alone, so the world layers keep the main frame's culls.
      if (solo === undefined) world.cullTo(camera, w, h);
      this.pool.mapViewPass(
        {
          camera,
          width: w,
          height: h,
          snapshot: scene.snapshot,
          viewport,
          tick: scene.tick,
          alpha: scene.alpha,
          elevation: scene.elevation,
          ...(scene.staticRefs !== undefined ? { staticRefs: scene.staticRefs } : {}),
          ...(solo !== undefined ? { solo } : {}),
        },
        scene.main,
        (keep) =>
          renderFramedWorld(this.app, this.worldLayer, this.floor, {
            camera,
            frame: new Rectangle(x, y, w, h),
            fill: view.soloFill ?? world.backdrop,
            keep,
          }),
      );
    } finally {
      if (solo === undefined) world.restore();
    }
  }
}

/** The target's lifted world point, or null for an entity the snapshot no longer holds. */
function targetPoint(
  target: MapViewTarget,
  snapshot: WorldSnapshot,
  elevation: ElevationField,
): { x: number; y: number } | null {
  if (target.kind === 'node') return projectNode(elevation, target.hx, target.hy);
  const entity = entityById(snapshot, target.ref);
  const pos = entity === undefined ? null : readPosition(entity.components);
  return pos === null ? null : projectTile(elevation, pos.x / ONE, pos.y / ONE);
}
