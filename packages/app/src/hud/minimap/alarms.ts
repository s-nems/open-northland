import { ONE, tileToScreenX, tileToScreenY, type WorldBounds } from '@open-northland/render';
import { type HalfCellNode, positionOfNode } from '@open-northland/sim';
import { Assets, Container, Graphics, Mesh, MeshGeometry, Rectangle, Sprite, Texture } from 'pixi.js';
import { uiFoundationArt } from '../../content/gui/ui-foundation.js';
import type { Rect } from '../geometry.js';
import { MARKER_RIM_COLOUR } from './palette.js';

/**
 * The attack alarm: red rings far wider than the minimap collapse onto the hit to pull the eye there,
 * then a red medallion bearing the attack notice's swords drops onto the spot over a red glow and
 * marks it until the alarm fades. The rings draw outside the minimap's clip, so past its edge they
 * show over the game view; the frame band and the DOM HUD panels are DOM above the canvas and cover
 * them. Every red stroke wears a dark rim so it reads over red enemy markers and bright
 * ground. All extents in minimap screen px; authored.
 */

/** How long one alarm shows, in wall-clock ms. */
export const ALARM_MS = 3800;
/** The share of the alarm's life over which everything fades out at the end. */
const FADE_SHARE = 0.18;

/** The collapsing rings: each starts wider than the largest minimap is across and shrinks onto the hit. */
const RING_COUNT = 2;
const RING_STAGGER_MS = 130;
const RING_MS = 460;
export const RING_START_RADIUS = 360;
const RING_START_WIDTH = 4;
const RING_END_WIDTH = 1.5;
/** The share of a ring's life over which it fades as it closes on the point. */
const RING_FADE_SHARE = 0.3;
/** The dark stroke under a red one reaches this far past it on each side. */
const RIM = 1;
const RIM_ALPHA = 0.75;

/** Segments around a ring: at the start radius a chord strays about a tenth of a minimap px off the circle. */
const RING_SEGMENTS = 128;

const GLOW_RADIUS = 9;
const GLOW_SWING = 2;
const GLOW_ALPHA = 0.8;
/** Wall-clock ms per radian of the glow's breathing and the medallion's bob. */
const GLOW_MS_PER_RADIAN = 130;
const BOB_MS_PER_RADIAN = 220;

/** The medallion starts dropping as the first ring closes in. */
export const PIN_DROP_START_MS = 300;
const PIN_DROP_MS = 380;
/** How high the medallion's centre stands over the hit, and how far it bobs. */
const PIN_LIFT = 17;
const PIN_BOB = 1.2;
const PIN_RADIUS = 10;
const PIN_RIM = 1.6;
/** The tail's half width and where it leaves the disc, as shares of the disc radius. */
const PIN_TAIL_HALF_WIDTH = 0.45;
const PIN_TAIL_ROOT = 0.8;
/** The swords' side as a share of the disc radius. */
const PIN_ICON_SHARE = 1.55;
/** The overshoot of the drop's ease-out-back. */
const DROP_OVERSHOOT = 1.9;

export const ALARM_RED = 0xff2a1f;
const HOT = 0xffe2d6;
const PIN_FACE = 0x2a1010;
const SWORDS_NOTICE = 'swords';
/** The glow texture's side in texture px; the sprite scales it to the glow radius. */
const GLOW_TEXTURE_SIDE = 64;
/** Where the glow's gradient turns from hot to red, as a share of its radius. */
const GLOW_RED_STOP = 0.35;
const GLOW_RED_ALPHA = 0.6;

export interface AlarmRing {
  readonly radius: number;
  readonly width: number;
  readonly alpha: number;
}

/** One alarm's look at a moment, in minimap screen px. */
export interface AlarmFrame {
  /** The whole alarm's opacity. */
  readonly alpha: number;
  readonly colour: number;
  readonly rings: readonly AlarmRing[];
  readonly glowRadius: number;
  /** The glow's opacity before `GLOW_ALPHA`: it rises with the medallion's drop. */
  readonly glowAlpha: number;
  /** The medallion's size as a share of its full size: it drops in with an overshoot. */
  readonly pinScale: number;
  /** How high the medallion's centre stands over the hit. */
  readonly pinLift: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutBack = (t: number): number =>
  1 + (DROP_OVERSHOOT + 1) * (t - 1) ** 3 + DROP_OVERSHOOT * (t - 1) ** 2;

/** The alarm `elapsed` ms after it was raised, or null once it has gone. */
export function alarmFrame(elapsed: number): AlarmFrame | null {
  if (elapsed < 0 || elapsed >= ALARM_MS) return null;
  const alpha = clamp01((1 - elapsed / ALARM_MS) / FADE_SHARE);
  const rings: AlarmRing[] = [];
  for (let k = 0; k < RING_COUNT; k++) {
    const local = (elapsed - k * RING_STAGGER_MS) / RING_MS;
    if (local < 0 || local > 1) continue;
    rings.push({
      radius: RING_START_RADIUS * (1 - easeOutCubic(local)),
      width: RING_START_WIDTH + (RING_END_WIDTH - RING_START_WIDTH) * local,
      alpha: clamp01((1 - local) / RING_FADE_SHARE) * alpha,
    });
  }
  const drop = clamp01((elapsed - PIN_DROP_START_MS) / PIN_DROP_MS);
  const landed = drop >= 1;
  return {
    alpha,
    colour: ALARM_RED,
    rings,
    glowRadius: GLOW_RADIUS + GLOW_SWING * Math.sin(elapsed / GLOW_MS_PER_RADIAN),
    glowAlpha: drop,
    pinScale: landed ? 1 : easeOutBack(drop),
    pinLift:
      PIN_LIFT +
      (landed ? PIN_BOB * Math.sin((elapsed - PIN_DROP_START_MS - PIN_DROP_MS) / BOB_MS_PER_RADIAN) : 0),
  };
}

/** Where an alarm at half-cell node `at` points, in the dot raster's px: the projection the dots use. */
export function alarmPoint(
  at: HalfCellNode,
  bounds: WorldBounds,
  rasterScale: number,
): { readonly x: number; readonly y: number } {
  const position = positionOfNode(at.hx, at.hy);
  const col = position.x / ONE;
  const row = position.y / ONE;
  return {
    x: (tileToScreenX(col, row) - bounds.minX) * rasterScale,
    y: (tileToScreenY(row) - bounds.minY) * rasterScale,
  };
}

/** Where an alarm's rings close in: the hit itself when the minimap shows it, otherwise the nearest
 *  point of `visible` (the shown part of the raster), so a hit zoomed out of view still marks its
 *  direction on the edge. */
export function ringCentre(
  point: { readonly x: number; readonly y: number },
  visible: Rect,
): { readonly x: number; readonly y: number } {
  return {
    x: Math.max(visible.x, Math.min(visible.x + visible.w, point.x)),
    y: Math.max(visible.y, Math.min(visible.y + visible.h, point.y)),
  };
}

export interface AlarmLayer {
  /** Raise an alarm at half-cell node `at`, starting at `now` ms. */
  add(at: HalfCellNode, now: number): void;
  /** Redraw the showing alarms; costs nothing once the last one has gone. `pxPerMinimapPx` converts
   *  minimap screen px to the container's raster px; `visible` is the shown part of the raster, in its
   *  px, that the rings' centre keeps to. */
  draw(now: number, pxPerMinimapPx: number, visible: Rect): void;
}

interface Alarm {
  readonly x: number;
  readonly y: number;
  readonly start: number;
  readonly glow: Sprite;
  readonly swords: Sprite;
}

function cssColour(colour: number, alpha = 1): string {
  return `rgba(${(colour >> 16) & 0xff},${(colour >> 8) & 0xff},${colour & 0xff},${alpha})`;
}

/** A hot centre through red to clear, baked once on a canvas. */
function bakeGlow(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIDE;
  canvas.height = GLOW_TEXTURE_SIDE;
  const g = canvas.getContext('2d');
  const half = GLOW_TEXTURE_SIDE / 2;
  if (g !== null) {
    const gradient = g.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, cssColour(HOT));
    gradient.addColorStop(GLOW_RED_STOP, cssColour(ALARM_RED, GLOW_RED_ALPHA));
    gradient.addColorStop(1, cssColour(ALARM_RED, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, GLOW_TEXTURE_SIDE, GLOW_TEXTURE_SIDE);
  }
  return Texture.from(canvas);
}

/** One collapsing ring: a dark band under a red one, each a mesh that owns its vertices. */
interface RingBands {
  readonly rim: Mesh<MeshGeometry>;
  readonly red: Mesh<MeshGeometry>;
}

/** A band around the origin, {@link RING_SEGMENTS} quads between an inner and an outer circle, drawn
 *  outside the batches from its own buffers. Its vertices pair up inner then outer per step and wait for
 *  {@link shapeBand}. */
function mintBand(): Mesh<MeshGeometry> {
  const steps = RING_SEGMENTS + 1;
  const indices = new Uint32Array(RING_SEGMENTS * 6);
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = 2 * i;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], 6 * i);
  }
  const geometry = new MeshGeometry({
    positions: new Float32Array(steps * 4),
    uvs: new Float32Array(steps * 4),
    indices,
  });
  geometry.batchMode = 'no-batch';
  const band = new Mesh({ geometry, texture: Texture.WHITE });
  band.once('destroyed', () => geometry.destroy());
  return band;
}

/** Lay `band` out around `centre` as a circle of `radius` stroked `width` wide, in `colour` at `alpha`. */
function shapeBand(
  band: Mesh<MeshGeometry>,
  centre: { readonly x: number; readonly y: number },
  radius: number,
  width: number,
  colour: number,
  alpha: number,
): void {
  const positions = band.geometry.positions;
  const inner = Math.max(0, radius - width / 2);
  const outer = radius + width / 2;
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const angle = (2 * Math.PI * i) / RING_SEGMENTS;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions[4 * i] = inner * cos;
    positions[4 * i + 1] = inner * sin;
    positions[4 * i + 2] = outer * cos;
    positions[4 * i + 3] = outer * sin;
  }
  band.geometry.getBuffer('aPosition').update();
  band.position.set(centre.x, centre.y);
  band.tint = colour;
  band.alpha = alpha;
  band.visible = true;
}

/** Hand `onLoad` the attack notice's swords cell once the HUD chrome pack's notice atlas has loaded;
 *  without the pack the medallion stays bare. */
function loadSwords(onLoad: (texture: Texture) => void): void {
  const art = uiFoundationArt();
  if (art === null) return;
  const { notices } = art.manifest;
  const index = notices.names.indexOf(SWORDS_NOTICE);
  if (index < 0) return;
  void Assets.load<Texture>(art.noticesUrl).then((atlas) => {
    const frame = new Rectangle(
      (index % notices.columns) * notices.cell,
      Math.floor(index / notices.columns) * notices.cell,
      notices.cell,
      notices.cell,
    );
    onLoad(new Texture({ source: atlas.source, frame }));
  });
}

/**
 * The attack alarms over the minimap's markers, in the dot raster's px. `clipped` holds the glow and
 * the medallion inside the minimap's clip; `unclipped` shares its transform without the clip and holds
 * the rings. Parented on creation, so the caller creates it above the dots in draw order.
 */
export function createAlarmLayer(
  clipped: Container,
  unclipped: Container,
  bounds: WorldBounds,
  rasterScale: number,
): AlarmLayer {
  const glows = new Container();
  const graphics = new Graphics();
  const icons = new Container();
  const rings = new Container();
  /** Ring bands in draw order, kept and reshaped: as many as rings ever showed at once. */
  const ringBands: RingBands[] = [];
  clipped.addChild(glows, graphics, icons);
  unclipped.addChild(rings);
  let glowTexture: Texture | null = null;
  let swordsTexture = Texture.EMPTY;
  loadSwords((texture) => {
    swordsTexture = texture;
  });
  let alarms: Alarm[] = [];
  let drawn = false;

  return {
    add: (at, now) => {
      glowTexture ??= bakeGlow();
      const glow = new Sprite(glowTexture);
      glow.anchor.set(1 / 2);
      const swords = new Sprite(swordsTexture);
      swords.anchor.set(1 / 2);
      glows.addChild(glow);
      icons.addChild(swords);
      alarms.push({ ...alarmPoint(at, bounds, rasterScale), start: now, glow, swords });
    },
    draw: (now, px, visible) => {
      if (alarms.length === 0 && !drawn) return;
      graphics.clear();
      let shownRings = 0;
      const showing: Alarm[] = [];
      for (const alarm of alarms) {
        const frame = alarmFrame(now - alarm.start);
        if (frame === null) {
          alarm.glow.destroy();
          alarm.swords.destroy();
          continue;
        }
        showing.push(alarm);
        const { x, y } = alarm;
        const glowSide = 2 * frame.glowRadius * px;
        alarm.glow.position.set(x, y);
        alarm.glow.setSize(glowSide, glowSide);
        alarm.glow.alpha = GLOW_ALPHA * frame.glowAlpha * frame.alpha;
        const centre = ringCentre(alarm, visible);
        for (const ring of frame.rings) {
          let bands = ringBands[shownRings];
          if (bands === undefined) {
            bands = { rim: mintBand(), red: mintBand() };
            ringBands.push(bands);
            rings.addChild(bands.rim, bands.red);
          }
          shownRings++;
          const radius = ring.radius * px;
          const rimWidth = (ring.width + 2 * RIM) * px;
          shapeBand(bands.rim, centre, radius, rimWidth, MARKER_RIM_COLOUR, RIM_ALPHA * ring.alpha);
          shapeBand(bands.red, centre, radius, ring.width * px, frame.colour, ring.alpha);
        }
        const radius = PIN_RADIUS * frame.pinScale * px;
        const cy = y - frame.pinLift * frame.pinScale * px;
        const tailY = cy + PIN_TAIL_ROOT * radius;
        const tailHalf = PIN_TAIL_HALF_WIDTH * radius;
        const rim = PIN_RIM * frame.pinScale * px;
        graphics
          .poly([x - tailHalf, tailY, x, y, x + tailHalf, tailY])
          .fill({ color: frame.colour, alpha: frame.alpha })
          .stroke({ width: rim / 2, color: MARKER_RIM_COLOUR, alpha: frame.alpha })
          .circle(x, cy, radius)
          .fill({ color: PIN_FACE, alpha: frame.alpha })
          .stroke({ width: 2 * rim, color: MARKER_RIM_COLOUR, alpha: frame.alpha })
          .circle(x, cy, radius)
          .stroke({ width: rim, color: frame.colour, alpha: frame.alpha });
        const iconSide = PIN_ICON_SHARE * radius;
        if (alarm.swords.texture !== swordsTexture) alarm.swords.texture = swordsTexture;
        alarm.swords.position.set(x, cy);
        alarm.swords.setSize(iconSide, iconSide);
        alarm.swords.alpha = frame.alpha;
      }
      for (let i = shownRings; i < ringBands.length; i++) {
        const bands = ringBands[i];
        if (bands === undefined) continue;
        bands.rim.visible = false;
        bands.red.visible = false;
      }
      alarms = showing;
      drawn = showing.length > 0;
    },
  };
}
