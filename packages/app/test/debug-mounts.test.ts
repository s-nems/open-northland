import { expect, it } from 'vitest';
import type { PerfOverlayHandle } from '../src/view/perf-overlay.js';
import { type DebugMountsOptions, mountDebugOverlays } from '../src/view/runtime/debug-mounts.js';

it('hides the debug readout with the HUD, and shows it again only while the tools are on', () => {
  let visible = false;
  const perf: PerfOverlayHandle = {
    update: () => undefined,
    place: () => undefined,
    setVisible: (next) => {
      visible = next;
    },
    dispose: () => undefined,
  };
  // A shared clock mounts no admin palette, so the readout is the only DOM surface left to follow.
  const mounts = mountDebugOverlays({
    params: new URLSearchParams(),
    perf,
    initialToolsEnabled: true,
    paletteTop: 0,
    allowWorldEdits: false,
    buildingsByType: new Map(),
    renderer: { setGeometryDebug: () => undefined },
  } as unknown as DebugMountsOptions);
  expect(visible).toBe(true);

  mounts.setHudHidden(true);
  expect(visible).toBe(false);
  mounts.setToolsEnabled(false);
  mounts.setToolsEnabled(true);
  expect(visible).toBe(false);
  mounts.setHudHidden(false);
  expect(visible).toBe(true);

  mounts.setToolsEnabled(false);
  mounts.setHudHidden(true);
  mounts.setHudHidden(false);
  expect(visible).toBe(false);
  mounts.dispose();
});
