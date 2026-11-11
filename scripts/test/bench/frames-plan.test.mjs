import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_PAN_SECONDS,
  firstPanEllipse,
  parseGraphicsKnobs,
  parseWindowSpec,
  WINDOWS,
} from '../../bench/browser/frames-plan.mjs';

test('a window spec names cameras and the moving and panning windows, with a speed each', () => {
  assert.equal(parseWindowSpec(undefined), undefined);
  assert.deepEqual(parseWindowSpec('dense:3,wide-move:3,first-pan:3'), [
    { cameraName: 'dense', speed: 3 },
    { cameraName: 'wide-move', speed: 3 },
    { cameraName: 'first-pan', speed: 3 },
  ]);
  assert.equal(WINDOWS['wide-move'].camera, 'wide');
  assert.equal(WINDOWS['wide-move'].pointer, 'move');
  assert.throws(() => parseWindowSpec('nope:3'), /window:speed/);
  assert.throws(() => parseWindowSpec('dense:1.5'), /window:speed/);
});

test('the graphics knobs default to xBR at render scale 1 and switch the filter off on request', () => {
  assert.deepEqual(parseGraphicsKnobs({}), {
    filter: 'xbr',
    renderScale: 1,
    detail: 'automatic',
    settings: { enhancedSampling: true, pixelArtScaler: 'xbr', renderScale: 1, distantDetail: false },
  });
  const off = parseGraphicsKnobs({ ON_BENCH_BROWSER_FILTER: 'off', ON_BENCH_BROWSER_RENDER_SCALE: '0.5' });
  assert.deepEqual(off.settings, { enhancedSampling: false, renderScale: 0.5, distantDetail: false });
  assert.equal(parseGraphicsKnobs({ ON_BENCH_BROWSER_DETAIL: 'full' }).settings.distantDetail, true);
  assert.throws(() => parseGraphicsKnobs({ ON_BENCH_BROWSER_DETAIL: 'some' }), /DETAIL/);
  assert.throws(() => parseGraphicsKnobs({ ON_BENCH_BROWSER_FILTER: 'bilinear' }), /FILTER/);
  assert.throws(() => parseGraphicsKnobs({ ON_BENCH_BROWSER_RENDER_SCALE: '3' }), /RENDER_SCALE/);
});

test('the first pan leaves the town and comes back after one lap at the arrow keys rate', () => {
  const town = { x: 5000, y: 3000 };
  const ellipse = firstPanEllipse(town, 1);
  const at = (seconds) => {
    const angle = seconds * ellipse.radiansPerSecond;
    return { x: ellipse.cx - ellipse.rx * Math.cos(angle), y: ellipse.cy + ellipse.ry * Math.sin(angle) };
  };
  assert.deepEqual(at(0), town);
  const end = at(FIRST_PAN_SECONDS);
  assert.ok(Math.hypot(end.x - town.x, end.y - town.y) < 1e-6);
  let length = 0;
  const steps = 10000;
  for (let i = 1; i <= steps; i++) {
    const a = at(((i - 1) * FIRST_PAN_SECONDS) / steps);
    const b = at((i * FIRST_PAN_SECONDS) / steps);
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  assert.ok(Math.abs(length / FIRST_PAN_SECONDS - 900) < 5, `mean ${length / FIRST_PAN_SECONDS} px/s`);
  assert.ok(Math.abs(firstPanEllipse(town, 0.5).rx - 2 * ellipse.rx) < 1e-6, 'world px scale with zoom');
});
