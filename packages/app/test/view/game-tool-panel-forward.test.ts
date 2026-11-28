import { describe, expect, it, vi } from 'vitest';
import type { ToolPanelOptions } from '../../src/hud/tool-panel/index.js';
import { type GameToolPanelDeps, mountGameToolPanel } from '../../src/view/game-tool-panel.js';

// The wrapper passes its deps to the panel mount as an explicit literal, so a dep the wrapper
// forgets to forward dies silently: the call site spreads its watch opts into the wrapper call,
// which suppresses the excess-property check that would name the stranger. This mock catches the
// options the mount receives, so the watch bar opts - once lost this way - are proven to cross.
const mounted: ToolPanelOptions[] = [];
vi.mock('../../src/hud/tool-panel/index.js', () => ({
  mountToolPanel: async (opts: ToolPanelOptions) => {
    mounted.push(opts);
    return { claimsPointer: () => false, dispose: () => {} };
  },
}));

/** Only the watch fields: the rest of the deps reach the mocked mount unread. */
const depsWith = (
  watch: Partial<Pick<GameToolPanelDeps, 'replayCycle' | 'replay'>> = {},
): GameToolPanelDeps =>
  ({
    canvas: {} as HTMLCanvasElement,
    plane: {} as HTMLElement,
    ...watch,
  }) as GameToolPanelDeps;

describe('the game tool panel wrapper', () => {
  it('hands the watch tempo cycle and progress cell down to the panel mount', async () => {
    await mountGameToolPanel(depsWith({ replayCycle: true, replay: { untilTick: 600 } }));
    const opts = mounted.at(-1);
    expect(opts?.replayCycle).toBe(true);
    expect(opts?.replay).toEqual({ untilTick: 600 });
  });

  it('leaves the watch bar opts out for a session that plays no recording', async () => {
    await mountGameToolPanel(depsWith());
    const opts = mounted.at(-1);
    expect(opts?.replayCycle).toBeUndefined();
    expect(opts?.replay).toBeUndefined();
  });
});
