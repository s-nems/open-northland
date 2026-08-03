import { afterEach, describe, expect, it } from 'vitest';
import type { ContentStatus } from '../../src/content-state.js';
import { formatMessage, messages, setActiveLocale } from '../../src/i18n/index.js';
import { type PickState, type Probe, pickView } from '../../src/setup/pick-view.js';

const VALID_WITH_MOD: Probe = { kind: 'valid', path: '/games/cultures', hasMod: true };
const VALID_WITHOUT_MOD: Probe = { kind: 'valid', path: '/games/cultures', hasMod: false };
const EXTERNAL_MOD = '/data/mods/CnMod 1.3.1';

function state(probe: Probe, overrides: Partial<PickState> = {}): PickState {
  return { probe, externalModRoot: undefined, contentStatus: 'missing', ...overrides };
}

const t = () => messages().setup;

afterEach(() => {
  setActiveLocale('eng');
});

describe('pick phase view', () => {
  it('says nothing and blocks install until a folder is probed', () => {
    const view = pickView(state({ kind: 'idle' }));
    expect(view.probeNote).toBe('');
    expect(view.installDisabled).toBe(true);
    expect(view.modPanelVisible).toBe(false);
  });

  it('refuses a folder that holds no game archives', () => {
    const view = pickView(state({ kind: 'no-archives' }));
    expect(view.probeNote).toBe(t().probe.noArchives);
    expect(view.installDisabled).toBe(true);
    expect(view.modPanelVisible).toBe(false);
  });

  it('enables install for a game folder that already carries the mod', () => {
    const view = pickView(state(VALID_WITH_MOD));
    expect(view.probeNote).toBe(t().probe.withMod);
    expect(view.installDisabled).toBe(false);
    expect(view.modPanelVisible).toBe(false);
  });

  it('offers the mod step for a game folder missing the mod', () => {
    const view = pickView(state(VALID_WITHOUT_MOD));
    expect(view.probeNote).toBe(t().probe.noMod);
    expect(view.installDisabled).toBe(true);
    expect(view.modPanelVisible).toBe(true);
  });

  it('names the mod resolved outside the game folder and unblocks install', () => {
    const view = pickView(state(VALID_WITHOUT_MOD, { externalModRoot: EXTERNAL_MOD }));
    expect(view.probeNote).toBe(formatMessage(t().probe.externalMod, { path: EXTERNAL_MOD }));
    expect(view.installDisabled).toBe(false);
    expect(view.modPanelVisible).toBe(false);
  });

  it('keeps the mod step out of sight while no game folder is settled', () => {
    const view = pickView(state({ kind: 'idle' }, { externalModRoot: EXTERNAL_MOD }));
    expect(view.modPanelVisible).toBe(false);
    expect(view.installDisabled).toBe(true);
  });

  it('prefers the folder-local mod over an external one in the note', () => {
    const view = pickView(state(VALID_WITH_MOD, { externalModRoot: EXTERNAL_MOD }));
    expect(view.probeNote).toBe(t().probe.withMod);
  });

  it('reports no installed content on the true first run', () => {
    const view = pickView(state(VALID_WITH_MOD, { contentStatus: 'missing' }));
    expect(view.installLabel).toBe(t().install);
    expect(view.statusNote).toBeUndefined();
    expect(view.playNowLabel).toBeUndefined();
  });

  it('offers play beside a regeneration once content is ready', () => {
    const view = pickView(state(VALID_WITH_MOD, { contentStatus: 'ready' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.ready, blocking: false });
    expect(view.playNowLabel).toBe(t().play);
  });

  it('lets an older revision be played anyway', () => {
    const view = pickView(state(VALID_WITH_MOD, { contentStatus: 'stale-revision' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.staleRevision, blocking: false });
    expect(view.playNowLabel).toBe(t().playAnyway);
  });

  it('blocks play entirely on an incompatible schema', () => {
    const view = pickView(state(VALID_WITH_MOD, { contentStatus: 'stale-schema' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.staleSchema, blocking: true });
    expect(view.playNowLabel).toBeUndefined();
  });

  it('keeps install reachable for every content status once the game folder is valid', () => {
    const statuses: readonly ContentStatus[] = ['missing', 'ready', 'stale-revision', 'stale-schema'];
    for (const contentStatus of statuses) {
      expect(pickView(state(VALID_WITH_MOD, { contentStatus })).installDisabled).toBe(false);
    }
  });

  it('words the whole phase in the active locale', () => {
    setActiveLocale('pol');
    const view = pickView(state({ kind: 'no-archives' }, { contentStatus: 'ready' }));
    expect(view.probeNote).toBe(messages('pol').setup.probe.noArchives);
    expect(view.installLabel).toBe(messages('pol').setup.regenerate);
    expect(view.playNowLabel).toBe(messages('pol').setup.play);
  });
});
