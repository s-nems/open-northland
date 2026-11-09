import assert from 'node:assert/strict';
import test from 'node:test';
import { seedHarnessSettings } from '../browser/harness-settings.mjs';
import {
  cameraAt,
  checkpointSession,
  MAX_LOAD_PER_CPU,
  overloaded,
  parseDeviceScale,
  parseViewport,
} from '../browser/session.mjs';

const SEARCH =
  'map=krwawa_rzeka&player=1&tribes=1:2&difficulty=1:hard&computer=1,2&seed=7&fog=classic&needs=off';

function save(session = {}) {
  return {
    header: {
      mapId: 'krwawa_rzeka',
      tick: 50002,
      seed: 7,
      session: { search: SEARCH, stateHash: 'abc', ...session },
    },
  };
}

test('a checkpoint replays as the session its stamp names, watched by the observer', () => {
  const { header, stateHash, params } = checkpointSession(save());
  assert.equal(header.tick, 50002);
  assert.equal(stateHash, 'abc');
  for (const [key, value] of new URLSearchParams(SEARCH))
    if (key !== 'player') assert.equal(params.get(key), value);
  assert.equal(params.get('player'), 'observer');
  assert.equal(params.get('zoom'), '1');
  assert.equal(params.get('fullscreen'), 'off');
});

test('a checkpoint without a session search or state hash, or with another map, is refused', () => {
  assert.throws(() => checkpointSession(save({ stateHash: undefined })), /bench:map checkpoint/);
  assert.throws(
    () => checkpointSession(save({ search: undefined, machineSeats: [1, 2] })),
    /bench:map checkpoint/,
  );
  assert.throws(() => checkpointSession({}), /bench:map checkpoint/);
  assert.throws(
    () => checkpointSession(save({ search: SEARCH.replace('krwawa_rzeka', 'oczy_weza') })),
    /another map or seed/,
  );
});

test('a camera centres the point in the window at its scale', () => {
  assert.deepEqual(cameraAt({ x: 100, y: 50 }, 2, { width: 1000, height: 600 }), {
    scale: 2,
    offsetX: 300,
    offsetY: 200,
  });
});

test('the load gate trips above the limit and ignores an unavailable reading', () => {
  const load = (loadPerCpu, available = true) => ({ available, loadPerCpu });
  assert.equal(overloaded(load(MAX_LOAD_PER_CPU), load(1)), false);
  assert.equal(overloaded(load(1), load(MAX_LOAD_PER_CPU + 0.1)), true);
  assert.equal(overloaded(load(null, false)), false);
});

test('a bench viewport is WxH, the default window when unset', () => {
  assert.deepEqual(parseViewport(undefined), { width: 1440, height: 900 });
  assert.deepEqual(parseViewport('1920x1080'), { width: 1920, height: 1080 });
  for (const text of ['1920', '1920x', '0x900', '1920X1080', '1920x1080.5'])
    assert.throws(() => parseViewport(text), /ON_BENCH_VIEWPORT must be WxH/);
});

test('a bench device scale is a positive ratio, 1 when unset', () => {
  assert.equal(parseDeviceScale(undefined), 1);
  assert.equal(parseDeviceScale('2'), 2);
  for (const text of ['0', '-1', 'retina'])
    assert.throws(() => parseDeviceScale(text), /ON_BENCH_DEVICE_SCALE must be a positive number/);
});

/** Runs the init script a harness registers against a stand-in `window`, as the page would. */
async function seededSettings(windowStub) {
  let script;
  let arg;
  await seedHarnessSettings({
    addInitScript: async (fn, value) => {
      script = fn;
      arg = value;
    },
  });
  const previous = globalThis.window;
  globalThis.window = windowStub;
  try {
    script(arg);
  } finally {
    globalThis.window = previous;
  }
}

test('a harness page passes the original-game gate and sends no error report by itself', async () => {
  const items = new Map([
    ['open-northland.settings', JSON.stringify({ language: 'pol', autoErrorReports: true })],
  ]);
  const localStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
  await seededSettings({ localStorage });
  assert.deepEqual(JSON.parse(items.get('open-northland.settings')), {
    language: 'pol',
    autoErrorReports: false,
    originalGameVerified: true,
  });
  // about:blank refuses storage; the seed leaves it alone instead of throwing in the page.
  const blank = Object.defineProperty({}, 'localStorage', {
    get() {
      throw new Error('SecurityError');
    },
  });
  await seededSettings(blank);
});
