import { NODE_PX, NODE_ROW_PX, type Point } from './geometry.js';
import { shape } from './svg.js';

/** The narrowest mesh triangle a figure draws, in viewBox units; a finer ground reads as a grey wash. */
const MIN_MESH_PX = 22;
/** How far into the patch the mesh starts to fade, as a share of its half size. */
const FADE_FROM = 0.55;

let maskSerial = 0;

/**
 * The ground under a figure: the map's triangle lattice as the screen shows it, rows straight across and
 * two slants through each point, fading out at the patch's edge instead of ending in a frame. At a
 * zoom where node triangles are finer than {@link MIN_MESH_PX} it draws every n-th node, so its shape
 * shows the ground's tilt but its triangles are not countable map points. `centre` is a lattice point.
 */
export function groundMesh(centre: Point, halfWidth: number, halfHeight: number, scale: number): SVGElement {
  const nodes = Math.max(1, Math.ceil(MIN_MESH_PX / (NODE_PX * scale)));
  const pitch = nodes * NODE_PX * scale;
  const rowPitch = nodes * NODE_ROW_PX * scale;
  const top = centre.y - halfHeight;
  const bottom = centre.y + halfHeight;
  const slant = (pitch / 2 / rowPitch) * halfHeight;
  const rows = Math.ceil(halfHeight / rowPitch);
  const columns = Math.ceil((halfWidth + slant) / pitch);
  const left = centre.x - halfWidth;
  const right = centre.x + halfWidth;
  const lines: string[] = [];
  for (let j = -rows; j <= rows; j++) {
    const y = centre.y + j * rowPitch;
    lines.push(`M${left} ${y}H${right}`);
  }
  for (let i = -columns; i <= columns; i++) {
    const x = centre.x + i * pitch;
    lines.push(`M${x - slant} ${top}L${x + slant} ${bottom}`, `M${x + slant} ${top}L${x - slant} ${bottom}`);
  }
  maskSerial += 1;
  const fade = `kn-fig-fade-${maskSerial}`;
  const mask = `kn-fig-ground-${maskSerial}`;
  const box = { x: left, y: top, width: 2 * halfWidth, height: 2 * halfHeight };
  return shape(
    'g',
    {},
    shape(
      'defs',
      {},
      shape(
        'radialGradient',
        { id: fade },
        shape('stop', { offset: FADE_FROM, 'stop-color': 'white' }),
        shape('stop', { offset: 1, 'stop-color': 'black' }),
      ),
      shape('mask', { id: mask }, shape('rect', { ...box, fill: `url(#${fade})` })),
    ),
    shape('path', { d: lines.join(''), class: 'kn-fig__mesh', mask: `url(#${mask})` }),
  );
}
