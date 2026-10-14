import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { readCampaignProgress } from '../src/campaign/progress.js';
import { createCampaignRuntime } from '../src/campaign/runtime.js';
import { campaignFixture, memoryStorage } from './support/campaign.js';

function setup() {
  const campaign = campaignFixture();
  const storage = memoryStorage();
  const deps = {
    campaign,
    storage,
    pause: vi.fn(),
    resume: vi.fn(),
    play: vi.fn(async () => undefined),
    exit: vi.fn(),
    failed: vi.fn(),
    signal: new AbortController().signal,
  };
  return { ...deps, runtime: createCampaignRuntime(deps) };
}

describe('campaign handovers', () => {
  it('persists all grants before forwarding an exit or submap', () => {
    const t = setup();
    const proceed = vi.fn(() =>
      expect(readCampaignProgress(t.campaign, t.storage).unlocked).toContain('second'),
    );
    t.runtime.events(
      [
        { kind: 'missionExit', mission: 1 },
        { kind: 'missionCampaignUnlock', campaignId: 3, mapId: 20 },
      ],
      proceed,
    );
    expect(proceed).toHaveBeenCalledOnce();
  });
  it('claims a movie batch once, retaining grants after the movie event', async () => {
    const t = setup();
    const proceed = vi.fn();
    const events = [
      { kind: 'missionVideo', sequence: 0 },
      { kind: 'missionExit', mission: 1 },
      { kind: 'missionCampaignUnlock', campaignId: 3, mapId: 20 },
    ] as const;
    t.runtime.events(events, proceed);
    t.runtime.events(events, proceed);
    await vi.waitFor(() => expect(t.exit).toHaveBeenCalledOnce());
    expect(t.play).toHaveBeenCalledExactlyOnceWith(0);
    expect(proceed).not.toHaveBeenCalled();
    expect(readCampaignProgress(t.campaign, t.storage).unlocked).toContain('second');
  });
  it('restores retained grants and movie without requiring repeated events', async () => {
    const t = setup();
    const snapshot = {
      entities: [
        {
          id: 1,
          components: { MissionCampaign: { unlockedMaps: [{ campaignId: 3, mapId: 20 }], video: 0 } },
        },
      ],
    } as unknown as WorldSnapshot;
    t.runtime.restore(snapshot);
    await vi.waitFor(() => expect(t.play).toHaveBeenCalledWith(0));
    expect(readCampaignProgress(t.campaign, t.storage).unlocked).toContain('second');
  });
  it('does not access storage for ordinary events and retains grants when reads fail', () => {
    const t = setup();
    const proceed = vi.fn();
    vi.spyOn(t.storage, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Blocked storage', 'SecurityError');
    });
    t.runtime.events([{ kind: 'missionExit', mission: 1 }], proceed);
    expect(proceed).toHaveBeenCalledOnce();
    t.runtime.events([{ kind: 'missionCampaignUnlock', campaignId: 3, mapId: 20 }], proceed);
    expect(t.runtime.isPending()).toBe(true);
    expect(proceed).toHaveBeenCalledOnce();
    const retry = t.failed.mock.calls[0]?.[0] as (() => void) | undefined;
    retry?.();
    expect(readCampaignProgress(t.campaign, t.storage).unlocked).toContain('second');
  });
  it('keeps a failed grant batch for retry before transition', () => {
    const t = setup();
    const proceed = vi.fn();
    vi.spyOn(t.storage, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    t.runtime.events([{ kind: 'missionCampaignUnlock', campaignId: 3, mapId: 20 }], proceed);
    expect(proceed).not.toHaveBeenCalled();
    expect(t.runtime.isPending()).toBe(true);
    const retry = t.failed.mock.calls[0]?.[0] as (() => void) | undefined;
    retry?.();
    expect(proceed).toHaveBeenCalledOnce();
    expect(t.runtime.isPending()).toBe(false);
  });
});
