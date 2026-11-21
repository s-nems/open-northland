import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENHANCEMENT_SETTINGS,
  gpuScenarios,
  HIDEABLE_LAYERS,
  MAGNIFIERS,
  markdownTable,
  parseGpuBenchArgs,
  quantile,
  RENDER_SCALES,
  scenarioSettings,
  summarizeRepeats,
  TOGGLED_SETTINGS,
} from '../../bench/browser/gpu-plan.mjs';

const ORIGIN = 'http://127.0.0.1:5174';

function repeat(gpuMs, draws, frames, invalid = []) {
  const gl = {
    frames,
    drawsPerFrame: draws,
    textureBindsPerFrame: draws * 2,
    programsPerFrame: 1,
    uploadsPerFrame: 0,
    uploadKbPerFrame: 0,
    textureUploadsPerFrame: 0.5,
    textureUploadKbPerFrame: 64,
  };
  return { gpuMs, gl, invalid };
}

test('arguments default the output, window and repeats', () => {
  const options = parseGpuBenchArgs(['late.checkpoint', ORIGIN]);
  assert.equal(options.output, 'bench-out/gpu');
  assert.equal(options.seconds, 5);
  assert.equal(options.repeats, 3);
  assert.equal(options.origin.href, `${ORIGIN}/`);
  assert.equal(options.scenarios.length, gpuScenarios().length);
});

test('arguments refuse a missing origin, a non-HTTP origin and bad counts', () => {
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint']), /usage/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', 'file:///tmp']), /HTTP/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', ORIGIN, 'out', '0']), /window seconds/);
  assert.throws(() => parseGpuBenchArgs(['late.checkpoint', ORIGIN, 'out', '5', '1.5']), /repeats/);
});

test('a scenario filter keeps the named scenarios and refuses unknown names', () => {
  const env = { ON_BENCH_GPU_SCENARIOS: 'panel-x3,off-paused' };
  const options = parseGpuBenchArgs(['late.checkpoint', ORIGIN], env);
  assert.deepEqual(
    options.scenarios.map((entry) => entry.id),
    ['off-paused', 'panel-x3'],
  );
  assert.throws(
    () => parseGpuBenchArgs(['late.checkpoint', ORIGIN], { ON_BENCH_GPU_SCENARIOS: 'nope' }),
    /Unknown ON_BENCH_GPU_SCENARIOS nope/,
  );
});

test('the matrix covers every magnifier at zoom 0.5, 0.7, 1 and 2, and ids are unique', () => {
  const scenarios = gpuScenarios();
  const ids = scenarios.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const magnifier of MAGNIFIERS)
    for (const zoom of [0.5, 0.7, 1, 2])
      assert.ok(scenarios.some((entry) => entry.magnifier === magnifier && entry.zoom === zoom));
  assert.deepEqual(
    scenarios.filter((entry) => entry.weather !== null && entry.zoom === 1).map((entry) => entry.weather),
    ['rain', 'snow', 'sand', 'rain:100', 'snow:100', 'clear'],
  );
});

test('rain, sand, a blizzard and clear weather also run zoomed out, each against the clear sky', () => {
  const zoomedOut = gpuScenarios().filter((entry) => entry.weather !== null && entry.zoom === 0.5);
  assert.deepEqual(
    zoomedOut.map((entry) => [entry.id, entry.weather]),
    [
      ['weather-rain-x3-z0.5', 'rain'],
      ['weather-sand-x3-z0.5', 'sand'],
      ['weather-blizzard-x3-z0.5', 'snow:100'],
      ['weather-clear-x3-z0.5', 'clear'],
    ],
  );
  for (const entry of zoomedOut) assert.equal(entry.speed, 3);
});

test('the see-through scenario turns the view on with every setting as on-x3 has it', () => {
  const byId = new Map(gpuScenarios().map((entry) => [entry.id, entry]));
  const seeThrough = byId.get('see-through-x3');
  assert.equal(seeThrough.seeThrough, true);
  assert.deepEqual(scenarioSettings(seeThrough), scenarioSettings(byId.get('on-x3')));
  assert.deepEqual(
    [...byId.values()].filter((entry) => entry.seeThrough).map((entry) => entry.id),
    ['see-through-x3'],
  );
});

test('settings switch every enhancement together and turn the FPS counter on', () => {
  const [off] = gpuScenarios();
  const offSettings = scenarioSettings(off);
  for (const key of ENHANCEMENT_SETTINGS) assert.equal(offSettings[key], false);
  assert.equal(offSettings.pixelArtScaler, undefined);
  assert.equal(offSettings.fpsCounter, true);
  const prescaled = gpuScenarios().find((entry) => entry.id === 'magnify-xbrz-z2');
  const prescaledSettings = scenarioSettings(prescaled);
  for (const key of ENHANCEMENT_SETTINGS) assert.equal(prescaledSettings[key], true);
  assert.equal(prescaledSettings.pixelArtScaler, 'xbrz');
  const unmagnified = scenarioSettings(gpuScenarios().find((entry) => entry.id === 'magnify-off-z1'));
  assert.equal(unmagnified.enhancedSampling, false);
  assert.equal(unmagnified.softShadows, true);
});

test('each toggled setting runs off alone at zoom 1 and 0.5, blood and bones in the battle view', () => {
  const scenarios = gpuScenarios();
  for (const zoom of [1, 0.5]) {
    const z = zoom === 1 ? '' : `-z${zoom}`;
    const baseline = scenarios.find((entry) => entry.id === `on-x3${z}`);
    assert.equal(baseline.zoom, zoom);
    assert.deepEqual(baseline.patch, {});
    for (const key of TOGGLED_SETTINGS) {
      const toggled = scenarios.filter(
        (entry) =>
          entry.zoom === zoom &&
          entry.view !== 'coast' &&
          Object.keys(entry.patch).length === 1 &&
          entry.patch[key] === false,
      );
      assert.equal(toggled.length, 1, `${key} at zoom ${zoom}`);
      const [entry] = toggled;
      assert.equal(entry.speed, 3);
      const battle = key === 'blood' || key === 'bonesFade';
      assert.equal(entry.view, battle ? 'battle' : 'dense');
      assert.equal(entry.id, battle ? `battle-no-${key}-x3${z}` : `no-${key}-x3${z}`);
    }
    assert.equal(scenarios.find((entry) => entry.id === `battle-x3${z}`).view, 'battle');
  }
});

test('a toggle patch turns its setting off and pins every other one on', () => {
  const settings = scenarioSettings(gpuScenarios().find((entry) => entry.id === 'no-postFxEnabled-x3'));
  for (const key of TOGGLED_SETTINGS) assert.equal(settings[key], key !== 'postFxEnabled', key);
  assert.equal(settings.renderScale, 1);
  assert.equal(settings.pixelArtScaler, 'xbr');
  const off = scenarioSettings(gpuScenarios().find((entry) => entry.id === 'off-x3'));
  assert.equal(off.softShadows, false);
  assert.equal(off.blood, true, 'blood stays pinned on, since a stored patch would outlive its scenario');
});

test('render-scale scenarios set the backing multiplier with everything on', () => {
  for (const renderScale of RENDER_SCALES) {
    const entry = gpuScenarios().find((candidate) => candidate.id === `scale${renderScale}-x3`);
    const settings = scenarioSettings(entry);
    assert.equal(settings.renderScale, renderScale);
    for (const key of TOGGLED_SETTINGS) assert.equal(settings[key], true);
  }
});

test('the framing scenarios pair a coast, hidden roads, a hovered panel and the trade window', () => {
  const byId = new Map(gpuScenarios().map((entry) => [entry.id, entry]));
  assert.equal(byId.get('coast-x3').view, 'coast');
  assert.deepEqual(byId.get('coast-no-environmentMotion-x3').patch, { environmentMotion: false });
  assert.deepEqual(byId.get('roads-hidden-paused').hidden, ['roads']);
  assert.equal(scenarioSettings(byId.get('roads-hidden-off-paused')).enhancedSampling, false);
  assert.equal(byId.get('panel-hover-x3').pointer, 'world');
  assert.equal(byId.get('panel-x3').pointer, 'bar');
  assert.equal(byId.get('trade-x3').view, 'trade');
  for (const entry of byId.values())
    for (const layer of entry.hidden) assert.ok(HIDEABLE_LAYERS.includes(layer), entry.id);
});

test('the quantile is the nearest rank and null for no values', () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([4, 1, 3, 2], 0.5), 3);
  assert.equal(quantile([4, 1, 3, 2], 0.99), 4);
});

test('repeats fold to the lowest median and frame-weighted counts', () => {
  const summary = summarizeRepeats([repeat([5, 6, 7], 100, 100), repeat([3, 4, 9], 200, 300, ['load'])]);
  assert.equal(summary.gpuMs.minP50, 4);
  assert.deepEqual(summary.gpuMs.p50s, [6, 4]);
  assert.equal(summary.gl.frames, 400);
  assert.equal(summary.gl.drawsPerFrame, 175);
  assert.deepEqual(summary.invalid, ['load']);
});

test('a repeat without GPU readings leaves the figure empty', () => {
  const summary = summarizeRepeats([repeat([], 100, 10)]);
  assert.equal(summary.gpuMs.minP50, null);
  assert.deepEqual(summary.invalid, []);
});

test('the table prints one row per scenario with its void reasons', () => {
  const summary = summarizeRepeats([repeat([5], 100, 10, ['load', 'hidden'])]);
  const occlusion = { ghosted: 4, faded: 0 };
  const table = markdownTable([
    { id: 'panel-x3', zoom: 1, speed: 3, selected: 1, insets: 1, occlusion, summary },
  ]);
  const lines = table.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(
    lines[2],
    '| panel-x3 | 1 | x3 | 1 | 1 | 4 (0) | - | 5.00 | 5.00 | 100 | 200 | 1 | 0 (0) | 0.5 (64) | load, hidden |',
  );
});

test('a prescaled scenario prints its twins, their memory and the pages over budget', () => {
  const summary = summarizeRepeats([repeat([5], 100, 10)]);
  const prescale = { pages: 99, bytes: 1515929588, overBudget: 3, settled: true };
  const table = markdownTable([
    { id: 'magnify-xbrz-z1', zoom: 1, speed: 0, selected: 0, insets: 0, prescale, summary },
  ]);
  assert.match(table.split('\n')[2], /\| 99 \(1446, 3 over budget\) \|/);
});
