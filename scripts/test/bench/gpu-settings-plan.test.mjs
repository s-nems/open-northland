import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSettingsBenchArgs,
  rowId,
  sessionSettings,
  settingsSessions,
  summarizeCycles,
} from '../../bench/browser/gpu-settings-plan.mjs';

const ORIGIN = 'http://127.0.0.1:5174';

test('a row filter keeps the named rows and only the sessions and views they need', () => {
  const env = { ON_BENCH_SETTINGS_ROWS: 'night-town-z0.5-dayNight,day-town-z1-softShadows' };
  const options = parseSettingsBenchArgs(['late.checkpoint', ORIGIN], env);
  assert.deepEqual(rowIds(options.sessions), ['day-town-z1-softShadows', 'night-town-z0.5-dayNight']);
  assert.equal(options.cycles, 10);
  assert.throws(
    () => parseSettingsBenchArgs(['late.checkpoint', ORIGIN], { ON_BENCH_SETTINGS_ROWS: 'nope' }),
    /Unknown ON_BENCH_SETTINGS_ROWS nope/,
  );
  assert.throws(() => parseSettingsBenchArgs(['late.checkpoint', ORIGIN, 'out', '0']), /cycles/);
});

const rowIds = (sessions) =>
  sessions.flatMap((session) =>
    session.views.flatMap((view) => view.rows.map((entry) => rowId(session, view, entry))),
  );

test('the zoomed-out weather views run only when a row names them', () => {
  const defaults = rowIds(parseSettingsBenchArgs(['late.checkpoint', ORIGIN]).sessions);
  for (const weather of ['rain', 'snow', 'sand', 'storm', 'blizzard']) {
    assert.ok(defaults.includes(`${weather}-town-z1-weather`), weather);
    assert.ok(!defaults.includes(`${weather}-town-z0.5-weather`), weather);
  }
  const env = { ON_BENCH_SETTINGS_ROWS: 'rain-town-z0.5-control,rain-town-z0.5-weather' };
  assert.deepEqual(rowIds(parseSettingsBenchArgs(['late.checkpoint', ORIGIN], env).sessions), [
    'rain-town-z0.5-control',
    'rain-town-z0.5-weather',
  ]);
});

test('both daylight town views toggle the occlusion marks and the see-through view', () => {
  const day = settingsSessions().find((session) => session.id === 'day');
  for (const view of day.views.filter((candidate) => candidate.id === 'town')) {
    const byToggle = new Map(view.rows.map((entry) => [entry.toggle, entry]));
    assert.deepEqual(byToggle.get('occlusionFill').off, { occlusionFill: false });
    assert.deepEqual(byToggle.get('occlusionOutline').off, { occlusionOutline: false });
    assert.equal(byToggle.get('seeThrough').kind, 'seeThrough');
  }
  const settings = sessionSettings(day);
  assert.equal(settings.occlusionFill, true);
  assert.equal(settings.occlusionOutline, true);
  assert.equal(settings.backingDensity, 'auto');
});

test('the native-backing session draws every device pixel', () => {
  const native = settingsSessions().find((session) => session.id === 'native-backing');
  assert.equal(sessionSettings(native).backingDensity, 'native');
  assert.deepEqual(rowIds([native]), ['native-backing-town-z1-control']);
});

test('every view has a control row and row ids are unique', () => {
  const ids = [];
  for (const session of settingsSessions())
    for (const view of session.views) {
      assert.ok(view.rows.some((entry) => entry.kind === 'none'));
      for (const entry of view.rows) ids.push(rowId(session, view, entry));
    }
  assert.equal(new Set(ids).size, ids.length);
});

test('a session loads with every setting on, its own patch over them, and no timer queries', () => {
  const scaled = settingsSessions().find((session) => session.settings.renderScale !== undefined);
  const settings = sessionSettings(scaled);
  assert.equal(settings.renderScale, 1.5);
  assert.equal(settings.softShadows, true);
  assert.equal(settings.distantDetail, true);
  assert.equal(settings.pixelArtScaler, 'xbr');
  assert.equal(settings.fpsCounter, false);
});

test('the cost is the median of per-cycle differences, not the difference of medians', () => {
  const summary = summarizeCycles([
    { on: 10, off: 4, onSubmit: 2, offSubmit: 2 },
    { on: 5, off: 4, onSubmit: 3, offSubmit: 2 },
    { on: 6, off: 9, onSubmit: 1, offSubmit: 2 },
  ]);
  assert.deepEqual(summary, { submitMs: 2, onMs: 6, offMs: 4, costMs: 1, minMs: -3, maxMs: 6 });
});
