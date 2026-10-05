import { ONE, tileToScreenX, tileToScreenY, type WorldBounds } from '@open-northland/render';
import { type HalfCellNode, positionOfNode } from '@open-northland/sim';
import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { uiFoundationArt } from '../../content/ui-foundation.js';
import { MARKER_RIM_COLOUR } from './palette.js';

/**
 * The attack alarm: a medallion bearing the attack notice's swords drops onto the hit with its tip on
 * the spot, over a warm glow and two ripples, then fades. Gold, not red, so it stands out from the
 * red enemy markers it points at. All extents in minimap screen px; authored.
 */

/** How long one alarm shows, in wall-clock ms. */
export const ALARM_MS = 3800;
/** The share of the alarm's life over which everything fades out at the end. */
const FADE_SHARE = 0.18;

const GLOW_RADIUS = 9;
const GLOW_SWING = 2;
const GLOW_ALPHA = 0.8;
/** Wall-clock ms per radian of the glow's breathing and the medallion's bob. */
const GLOW_MS_PER_RADIAN = 130;
const BOB_MS_PER_RADIAN = 220;

const RIPPLE_COUNT = 2;
const RIPPLE_DELAY_MS = 150;
const RIPPLE_STAGGER_MS = 700;
const RIPPLE_MS = 1300;
const RIPPLE_START_RADIUS = 3;
const RIPPLE_SPREAD = 18;
const RIPPLE_START_WIDTH = 2;
const RIPPLE_END_WIDTH = 0.4;
/** The dark stroke under a ripple reaches this far past its gold one on each side. */
const RIPPLE_RIM = 1;
const RIPPLE_RIM_ALPHA = 0.7;

const PIN_DROP_MS = 420;
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

const GOLD = 0xffc846;
const HOT = 0xfff5dc;
const PIN_FACE = 0x2a1a10;
const SWORDS_NOTICE = 'swords';
/** The glow texture's side in texture px; the sprite scales it to the glow radius. */
const GLOW_TEXTURE_SIDE = 64;
/** Where the glow's gradient turns from white-hot to gold, as a share of its radius. */
const GLOW_GOLD_STOP = 0.35;
const GLOW_GOLD_ALPHA = 0.6;

export interface AlarmRipple {
  readonly radius: number;
  readonly width: number;
  readonly alpha: number;
}

/** One alarm's look at a moment, in minimap screen px. */
export interface AlarmFrame {
  /** The whole alarm's opacity. */
  readonly alpha: number;
  readonly glowRadius: number;
  readonly ripples: readonly AlarmRipple[];
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
  const ripples: AlarmRipple[] = [];
  for (let k = 0; k < RIPPLE_COUNT; k++) {
    const local = (elapsed - RIPPLE_DELAY_MS - k * RIPPLE_STAGGER_MS) / RIPPLE_MS;
    if (local < 0 || local > 1) continue;
    ripples.push({
      radius: RIPPLE_START_RADIUS + RIPPLE_SPREAD * easeOutCubic(local),
      width: RIPPLE_END_WIDTH + (RIPPLE_START_WIDTH - RIPPLE_END_WIDTH) * (1 - local),
      alpha: (1 - local) * alpha,
    });
  }
  const drop = clamp01(elapsed / PIN_DROP_MS);
  const landed = drop >= 1;
  return {
    alpha,
    glowRadius: GLOW_RADIUS + GLOW_SWING * Math.sin(elapsed / GLOW_MS_PER_RADIAN),
    ripples,
    pinScale: landed ? 1 : easeOutBack(drop),
    pinLift: PIN_LIFT + (landed ? PIN_BOB * Math.sin((elapsed - PIN_DROP_MS) / BOB_MS_PER_RADIAN) : 0),
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

export interface AlarmLayer {
  /** Raise an alarm at half-cell node `at`, starting at `now` ms. */
  add(at: HalfCellNode, now: number): void;
  /** Redraw the showing alarms; costs nothing once the last one has gone. `pxPerMinimapPx` converts
   *  minimap screen px to the container's raster px. */
  draw(now: number, pxPerMinimapPx: number): void;
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

/** A white-hot centre through gold to clear, baked once on a canvas. */
function bakeGlow(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIDE;
  canvas.height = GLOW_TEXTURE_SIDE;
  const g = canvas.getContext('2d');
  const half = GLOW_TEXTURE_SIDE / 2;
  if (g !== null) {
    const gradient = g.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, cssColour(HOT));
    gradient.addColorStop(GLOW_GOLD_STOP, cssColour(GOLD, GLOW_GOLD_ALPHA));
    gradient.addColorStop(1, cssColour(GOLD, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, GLOW_TEXTURE_SIDE, GLOW_TEXTURE_SIDE);
  }
  return Texture.from(canvas);
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
 * The attack alarms over the minimap's markers, in the dot raster's px. Parented on creation, so the
 * caller creates it above the dots in draw order.
 */
export function createAlarmLayer(container: Container, bounds: WorldBounds, rasterScale: number): AlarmLayer {
  const glows = new Container();
  const graphics = new Graphics();
  const icons = new Container();
  container.addChild(glows, graphics, icons);
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
    draw: (now, px) => {
      if (alarms.length === 0 && !drawn) return;
      graphics.clear();
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
        alarm.glow.alpha = GLOW_ALPHA * frame.alpha;
        for (const ripple of frame.ripples) {
          graphics
            .circle(x, y, ripple.radius * px)
            .stroke({
              width: (ripple.width + 2 * RIPPLE_RIM) * px,
              color: MARKER_RIM_COLOUR,
              alpha: RIPPLE_RIM_ALPHA * ripple.alpha,
            })
            .circle(x, y, ripple.radius * px)
            .stroke({ width: ripple.width * px, color: GOLD, alpha: ripple.alpha });
        }
        const radius = PIN_RADIUS * frame.pinScale * px;
        const cy = y - frame.pinLift * frame.pinScale * px;
        const tailY = cy + PIN_TAIL_ROOT * radius;
        const tailHalf = PIN_TAIL_HALF_WIDTH * radius;
        const rim = PIN_RIM * frame.pinScale * px;
        graphics
          .poly([x - tailHalf, tailY, x, y, x + tailHalf, tailY])
          .fill({ color: GOLD, alpha: frame.alpha })
          .stroke({ width: rim / 2, color: MARKER_RIM_COLOUR, alpha: frame.alpha })
          .circle(x, cy, radius)
          .fill({ color: PIN_FACE, alpha: frame.alpha })
          .stroke({ width: 2 * rim, color: MARKER_RIM_COLOUR, alpha: frame.alpha })
          .circle(x, cy, radius)
          .stroke({ width: rim, color: GOLD, alpha: frame.alpha });
        const iconSide = PIN_ICON_SHARE * radius;
        if (alarm.swords.texture !== swordsTexture) alarm.swords.texture = swordsTexture;
        alarm.swords.position.set(x, cy);
        alarm.swords.setSize(iconSide, iconSide);
        alarm.swords.alpha = frame.alpha;
      }
      alarms = showing;
      drawn = showing.length > 0;
    },
  };
}
