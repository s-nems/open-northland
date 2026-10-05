import { ONE, tileToScreenX, tileToScreenY, type WorldBounds } from '@open-northland/render';
import { type HalfCellNode, positionOfNode } from '@open-northland/sim';
import { type Container, Graphics } from 'pixi.js';
import { MARKER_RIM_COLOUR, STANCE_COLOURS } from './palette.js';

/** How long one alarm ring closes in on its hit, in wall-clock ms. Authored. */
export const ALARM_MS = 3000;
/** The ring's radius as it opens and as it closes, in minimap screen px. Authored. */
const ALARM_START_RADIUS = 24;
const ALARM_END_RADIUS = 3;
/** The red stroke and the dark one under it that parts it from any ground, in minimap screen px. */
const ALARM_STROKE = 2;
const ALARM_RIM_STROKE = 4;
/** The share of the ring's life over which it fades out at the end. Authored. */
const ALARM_FADE_SHARE = 0.25;
const ALARM_COLOUR = STANCE_COLOURS.enemy;

export interface AlarmRing {
  /** Minimap screen px. */
  readonly radius: number;
  readonly alpha: number;
}

/** The ring `elapsed` ms after its alarm, or null once it has closed. */
export function alarmRing(elapsed: number): AlarmRing | null {
  if (elapsed < 0 || elapsed >= ALARM_MS) return null;
  const t = elapsed / ALARM_MS;
  const radius = ALARM_START_RADIUS + (ALARM_END_RADIUS - ALARM_START_RADIUS) * t;
  const alpha = Math.min(1, (1 - t) / ALARM_FADE_SHARE);
  return { radius, alpha };
}

export interface AlarmLayer {
  /** Ring the half-cell node `at`, starting at `now` ms. */
  add(at: HalfCellNode, now: number): void;
  /** Redraw the open rings; costs nothing once the last one has closed. `pxPerMinimapPx` converts
   *  minimap screen px to the container's raster px. */
  draw(now: number, pxPerMinimapPx: number): void;
}

interface Alarm {
  readonly x: number;
  readonly y: number;
  readonly start: number;
}

/** Where a ring at half-cell node `at` centres, in the dot raster's px: the projection the dots use. */
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

/**
 * The attack alarms over the minimap's markers, in the dot raster's px. Parented on creation, so the
 * caller creates it above the dots in draw order.
 */
export function createAlarmLayer(container: Container, bounds: WorldBounds, rasterScale: number): AlarmLayer {
  const graphics = new Graphics();
  container.addChild(graphics);
  let alarms: Alarm[] = [];
  let drawn = false;
  return {
    add: (at, now) => {
      alarms.push({ ...alarmPoint(at, bounds, rasterScale), start: now });
    },
    draw: (now, pxPerMinimapPx) => {
      if (alarms.length === 0 && !drawn) return;
      graphics.clear();
      const open: Alarm[] = [];
      for (const alarm of alarms) {
        const ring = alarmRing(now - alarm.start);
        if (ring === null) continue;
        open.push(alarm);
        const radius = ring.radius * pxPerMinimapPx;
        graphics
          .circle(alarm.x, alarm.y, radius)
          .stroke({ width: ALARM_RIM_STROKE * pxPerMinimapPx, color: MARKER_RIM_COLOUR, alpha: ring.alpha })
          .circle(alarm.x, alarm.y, radius)
          .stroke({ width: ALARM_STROKE * pxPerMinimapPx, color: ALARM_COLOUR, alpha: ring.alpha });
      }
      alarms = open;
      drawn = open.length > 0;
    },
  };
}
