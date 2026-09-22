import {
  type Camera,
  type ElevationField,
  halfCellToScreen,
  type PalettedSprite,
} from '@open-northland/render';
import type { HalfCellNode, SimEvent } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { type GuiArt, makeGuiSprite } from '../content/gui-art.js';

/**
 * The markers a map script puts on the ground: the ten GUI marker slots, the area rings and the
 * import markers. Drawn as a screen overlay over the world at each point's projected position, the
 * way the original draws the GUI markers (reading: it cycles six bobs of the GUI
 * sheet at 150 ms in the player's palette). Approximations: the bobs draw in the GUI's context palette
 * rather than the player's, and the area and import markers, the original's own map entities with
 * their own art, draw with the first of those bobs.
 */

/** The six GUI sheet bobs the marker cycles through, and the cycle's pace (reading). */
const GUI_MARKER_FRAMES = [0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf] as const;
const GUI_MARKER_FRAME_MS = 150;
/** How far (screen px at zoom 1) past the screen edge a marker is still placed, so a bob's own
 *  offsets never pop it in. */
const OFFSCREEN_MARGIN = 64;
/** Half-side (screen px at zoom 1) and colours of the flat fallback diamond without decoded art. */
const FALLBACK_HALF = 8;
const FALLBACK_COLOR: Readonly<Record<MarkerStyle, number>> = {
  gui: 0xffd24a,
  area: 0x7fd0ff,
  magic: 0xc890ff,
  import: 0xa0e070,
};

type MarkerStyle = 'gui' | 'area' | 'magic' | 'import';

interface Marker {
  readonly style: MarkerStyle;
  readonly point: HalfCellNode;
}

interface MarkerSprite {
  readonly sprite: PalettedSprite;
  gfx: number;
}

const pointKey = (p: HalfCellNode): string => `${p.hx},${p.hy}`;

export interface ScriptMarkers {
  /** Apply a marker event; every other event is ignored. */
  apply(event: SimEvent): void;
  /** Per-frame: re-place every marker under the camera. */
  update(camera: Camera, screen: { readonly width: number; readonly height: number }, nowMs: number): void;
  dispose(): void;
}

export function createScriptMarkers(
  parent: Container,
  art: GuiArt | null,
  elevation?: ElevationField,
): ScriptMarkers {
  const container = new Container();
  parent.addChild(container);
  const fallback = new Graphics();
  container.addChild(fallback);
  /** GUI markers by slot; area and import markers by point. */
  const gui = new Map<number, Marker>();
  const ground = new Map<string, Marker>();
  const sprites: MarkerSprite[] = [];
  /** Whether the flat fallback holds strokes, so an empty frame never dirties it. */
  let drawnFallback = false;

  const markers = (): Marker[] => [...gui.values(), ...ground.values()];

  const spriteAt = (i: number, gfx: number): PalettedSprite | null => {
    if (art === null) return null;
    let slot = sprites[i];
    if (slot === undefined) {
      const built = makeGuiSprite(art, gfx, { defaultPalette: 'context', colorKey: 'full' });
      if (built === null) return null;
      slot = { sprite: built.sprite, gfx };
      sprites.push(slot);
      container.addChild(built.sprite);
    } else if (slot.gfx !== gfx) {
      const frame = art.layer.atlas.frames.get(gfx);
      if (frame === undefined) return null;
      slot.sprite.setFrame(art.layer.source, frame, art.layer.atlas.width, art.layer.atlas.height);
      slot.gfx = gfx;
    }
    slot.sprite.visible = true;
    return slot.sprite;
  };

  return {
    apply(event) {
      switch (event.kind) {
        case 'missionGuiMarker':
          if (event.placed) gui.set(event.marker, { style: 'gui', point: event.point });
          else gui.delete(event.marker);
          return;
        case 'missionAreaMarkers':
          for (const point of event.points) {
            if (event.placed) ground.set(pointKey(point), { style: event.magic ? 'magic' : 'area', point });
            else ground.delete(pointKey(point));
          }
          return;
        case 'missionImportMarker':
          if (event.placed) ground.set(pointKey(event.point), { style: 'import', point: event.point });
          else ground.delete(pointKey(event.point));
          return;
        default:
          return;
      }
    },
    update(camera, screen, nowMs) {
      if (gui.size + ground.size === 0 && !drawnFallback && sprites.every((slot) => !slot.sprite.visible))
        return;
      const zoom = camera.scale ?? 1;
      const phase = Math.floor(nowMs / GUI_MARKER_FRAME_MS) % GUI_MARKER_FRAMES.length;
      const animated = GUI_MARKER_FRAMES[phase] ?? GUI_MARKER_FRAMES[0];
      const still = GUI_MARKER_FRAMES[0];
      if (drawnFallback) fallback.clear();
      drawnFallback = false;
      for (const slot of sprites) slot.sprite.visible = false;
      const margin = OFFSCREEN_MARGIN * zoom;
      let placed = 0;
      for (const marker of markers()) {
        const { hx, hy } = marker.point;
        const world = halfCellToScreen(hx, hy);
        const lift = elevation?.liftAtNode(hx, hy) ?? 0;
        const sx = world.x * zoom + camera.offsetX;
        const sy = (world.y - lift) * zoom + camera.offsetY;
        // A marker off the screen costs nothing: no sprite is placed or uploaded for it.
        if (sx < -margin || sy < -margin || sx > screen.width + margin || sy > screen.height + margin)
          continue;
        const gfx = marker.style === 'gui' ? animated : still;
        const sprite = spriteAt(placed, gfx);
        const frame = art?.layer.atlas.frames.get(gfx);
        if (sprite !== null && frame !== undefined) {
          placed++;
          sprite.stretchToRect(
            sx + frame.offsetX * zoom,
            sy + frame.offsetY * zoom,
            frame.width * zoom,
            frame.height * zoom,
            screen.width,
            screen.height,
          );
          continue;
        }
        const half = FALLBACK_HALF * zoom;
        fallback
          .moveTo(sx, sy - half)
          .lineTo(sx + half, sy)
          .lineTo(sx, sy + half)
          .lineTo(sx - half, sy)
          .closePath()
          .fill(FALLBACK_COLOR[marker.style]);
        drawnFallback = true;
      }
    },
    dispose() {
      container.destroy({ children: true });
    },
  };
}
