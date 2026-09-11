import type { SpriteAtlas, SpriteLayer } from '@open-northland/render';
import { CanvasSource } from 'pixi.js';

let source: CanvasSource | undefined;

export function characterContactShadow(body: SpriteAtlas): Pick<SpriteLayer, 'source' | 'atlas'> {
  if (source === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('Contact shadow requires a canvas context');
    ctx.scale(3, 1);
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    // Approximation: a soft contact shadow shared by grounded civilian poses.
    gradient.addColorStop(0, 'rgba(24, 20, 15, 0.32)');
    gradient.addColorStop(1, 'rgba(24, 20, 15, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    source = new CanvasSource({ resource: canvas, scaleMode: 'linear' });
  }
  const frame = { x: 0, y: 0, width: 48, height: 16, offsetX: -24, offsetY: -8 };
  return {
    source,
    atlas: { width: 48, height: 16, frames: new Map([...body.frames.keys()].map((id) => [id, frame])) },
  };
}
