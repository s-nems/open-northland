import {
  type Camera,
  type ElevationField,
  halfCellToScreen,
  PalettedSprite,
  type PaletteLut,
} from '@open-northland/render';
import type { HalfCellNode, SimEvent } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import type { GuiArt } from '../../content/gui/art.js';

/**
 * The markers a map script puts on the ground: the ten GUI marker slots, the area rings and the
 * import markers. Drawn as a screen overlay over the world at each point's projected position, the
 * way the original draws the GUI markers (reading: it cycles six bobs of the GUI sheet at 150 ms
 * through the local player's `human_playerNN` palette). Approximation: the area and import markers,
 * the original's own map entities with their own art, draw with the first of those bobs in that palette.
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

/** The GUI sheet the marker bobs are cut from and the player palettes they draw through. */
export interface ScriptMarkerArt {
  readonly gui: GuiArt;
  /** Every colour slot's player palette, row = colour slot. */
  readonly players: PaletteLut;
}

const pointKey = (p: HalfCellNode): string => `${p.hx},${p.hy}`;

export interface ScriptMarkers {
  /** Apply a marker event; every other event is ignored. */
  apply(event: SimEvent): void;
  /** Per-frame: re-place every marker under the camera. */
  update(camera: Camera, screen: { readonly width: number; readonly height: number }, nowMs: number): void;
  dispose(): void;
}

/** `colourSlot` answers the colour slot of the seat the view shows, read every frame. */
export function createScriptMarkers(
  parent: Container,
  art: ScriptMarkerArt | null,
  colourSlot: () => number,
  elevation?: ElevationField,
): ScriptMarkers {
  const container = new Container();
  parent.addChild(container);
  const fallback = new Graphics();
  container.addChild(fallback);
  /** GUI markers by slot; area and import markers by point. */
  const gui = new Map<number, Marker>();
  const ground = new Map<string, Marker>();
  const sprites: PalettedSprite[] = [];
  /** Whether the flat fallback holds strokes, so an empty frame never dirties it. */
  let drawnFallback = false;

  const markers = (): Marker[] => [...gui.values(), ...ground.values()];

  const spriteAt = (i: number, gfx: number, row: number): PalettedSprite | null => {
    if (art === null) return null;
    const { layer } = art.gui;
    const frame = layer.atlas.frames.get(gfx);
    if (frame === undefined) return null;
    let sprite = sprites[i];
    if (sprite === undefined) {
      // No colour key: the black player's ramp lies in the band the GUI keys as near-black backdrop.
      sprite = new PalettedSprite(art.players.source, art.players.colours);
      sprites.push(sprite);
      container.addChild(sprite);
    }
    // Only a new bob re-frames: `stretchToRect` voids `setFrame`'s own unchanged-frame check.
    if (sprite.frame !== frame) sprite.setFrame(layer.source, frame, layer.atlas.width, layer.atlas.height);
    if (sprite.player !== row) sprite.player = row;
    sprite.visible = true;
    return sprite;
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
      if (gui.size + ground.size === 0 && !drawnFallback && sprites.every((sprite) => !sprite.visible))
        return;
      const zoom = camera.scale ?? 1;
      const phase = Math.floor(nowMs / GUI_MARKER_FRAME_MS) % GUI_MARKER_FRAMES.length;
      const animated = GUI_MARKER_FRAMES[phase] ?? GUI_MARKER_FRAMES[0];
      const still = GUI_MARKER_FRAMES[0];
      if (drawnFallback) fallback.clear();
      drawnFallback = false;
      for (const sprite of sprites) sprite.visible = false;
      const row = colourSlot();
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
        const sprite = spriteAt(placed, gfx, row);
        const frame = art?.gui.layer.atlas.frames.get(gfx);
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
