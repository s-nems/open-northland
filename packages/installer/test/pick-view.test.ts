import { afterEach, describe, expect, it } from 'vitest';
import type { ContentStatus } from '../src/content-state.js';
import { formatMessage, messages, setActiveLocale } from '../src/i18n/index.js';
import { type PickState, pickView } from '../src/setup/pick-view.js';

const MOD_ROOT = '/data/mods/CnMod 1.3.2';

function state(overrides: Partial<PickState> = {}): PickState {
  return { modRoot: undefined, contentStatus: 'missing', ...overrides };
}

const t = () => messages().setup;

afterEach(() => {
  setActiveLocale('eng');
});

describe('pick phase view', () => {
  it('offers the mod step and blocks install while no mod is known', () => {
    const view = pickView(state());
    expect(view.modNote).toBe('');
    expect(view.modPanelVisible).toBe(true);
    expect(view.installDisabled).toBe(true);
  });

  it('enables install once the shell holds a mod root, naming it', () => {
    const view = pickView(state({ modRoot: MOD_ROOT }));
    expect(view.modNote).toBe(formatMessage(t().mod.using, { path: MOD_ROOT }));
    expect(view.modPanelVisible).toBe(false);
    expect(view.installDisabled).toBe(false);
  });

  it('reports no installed content on the true first run', () => {
    const view = pickView(state({ modRoot: MOD_ROOT, contentStatus: 'missing' }));
    expect(view.installLabel).toBe(t().install);
    expect(view.statusNote).toBeUndefined();
    expect(view.playNowLabel).toBeUndefined();
  });

  it('offers play beside a regeneration once content is ready', () => {
    const view = pickView(state({ modRoot: MOD_ROOT, contentStatus: 'ready' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.ready, blocking: false });
    expect(view.playNowLabel).toBe(t().play);
  });

  it('lets an older revision be played anyway', () => {
    const view = pickView(state({ modRoot: MOD_ROOT, contentStatus: 'stale-revision' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.staleRevision, blocking: false });
    expect(view.playNowLabel).toBe(t().playAnyway);
  });

  it('blocks play entirely on an incompatible schema', () => {
    const view = pickView(state({ modRoot: MOD_ROOT, contentStatus: 'stale-schema' }));
    expect(view.installLabel).toBe(t().regenerate);
    expect(view.statusNote).toEqual({ text: t().status.staleSchema, blocking: true });
    expect(view.playNowLabel).toBeUndefined();
  });

  it('keeps install reachable for every content status once a mod is known', () => {
    const statuses: readonly ContentStatus[] = ['missing', 'ready', 'stale-revision', 'stale-schema'];
    for (const contentStatus of statuses) {
      expect(pickView(state({ modRoot: MOD_ROOT, contentStatus })).installDisabled).toBe(false);
    }
  });

  it('words the whole phase in the active locale', () => {
    setActiveLocale('pol');
    const view = pickView(state({ modRoot: MOD_ROOT, contentStatus: 'ready' }));
    expect(view.modNote).toBe(formatMessage(messages('pol').setup.mod.using, { path: MOD_ROOT }));
    expect(view.installLabel).toBe(messages('pol').setup.regenerate);
    expect(view.playNowLabel).toBe(messages('pol').setup.play);
  });
});
