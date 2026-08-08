import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

/**
 * The sandbox clips' transcribed `event <at> 34 <id>` cues. The sim sounds a settler's action off these
 * rows alone, so a clip missing them works in silence - and a clip the sandbox replays at its own tick
 * count needs its authored frame rescaled, or the sound drifts off the visible strike.
 */

const PLAY_SOUND_FX = 34;
const CHANGE_SOCIAL = 3;
/** `logicSoundType` ids from `soundfx.cif`: Woodcutter Axe, Hammer Wood, SocialTalk Male. */
const AXE = 9;
const HAMMER_WOOD = 1;
const SOCIALTALK_MALE = 61;

const content = sandboxContent(grassTerrain(8, 8));

function clip(name: string): { length: number; cues: { at: number; value: number | undefined }[] } {
  const anim = content.atomicAnimations.find((a) => a.name === name);
  if (anim === undefined) throw new Error(`sandbox content has no clip ${name}`);
  return {
    length: anim.length,
    cues: anim.events.filter((e) => e.type === PLAY_SOUND_FX).map((e) => ({ at: e.at, value: e.value })),
  };
}

describe('sandbox authored sound cues', () => {
  it('keeps a cue on its authored frame when the sandbox runs the clip at its authored length', () => {
    // `viking_collector_harvest_tree` is `length 30`, `event 19 34 9` - the axe lands two thirds in.
    const chop = clip('viking_collector_harvest_tree');
    expect(chop.length).toBe(30);
    expect(chop.cues).toEqual([{ at: 19, value: AXE }]);
  });

  it('rescales a cue onto a clip the sandbox runs at its own tick count', () => {
    // The mushroom pick loops the 19-frame pluck list three times plus a breather, so the sandbox clip is
    // 72 ticks against the authored 35 - the cue has to travel with it (`event 20 34 9`).
    const pick = clip('viking_collector_harvest_mushroom');
    expect(pick.length).toBe(72);
    expect(pick.cues).toEqual([{ at: Math.round((20 * pick.length) / 35), value: AXE }]);
    // The iron strike borrows the 29-frame stonecrushing list over its authored 23 (`event 16 34 6`).
    const iron = clip('viking_collector_harvest_iron');
    expect(iron.length).toBe(29);
    expect(iron.cues).toEqual([{ at: Math.round((16 * iron.length) / 23), value: 6 }]);
  });

  it('keeps the builder’s knock on the strike frame at the swing’s halved cadence', () => {
    // `viking_builder_build_house` is `length 15`, `event 4 34 1`, replayed here at two ticks per frame.
    const build = clip('viking_builder_build_house');
    expect(build.length).toBe(30);
    expect(build.cues).toEqual([{ at: 8, value: HAMMER_WOOD }]);
  });

  it('gives the chat clips their voice cue alongside the company-bar pulses', () => {
    const talk = content.atomicAnimations.find((a) => a.name === 'viking_civilist_talk');
    expect(talk?.events.filter((e) => e.type === PLAY_SOUND_FX)).toEqual([
      { at: 0, type: PLAY_SOUND_FX, value: SOCIALTALK_MALE, extended: false },
    ]);
    // The channel-3 refill rows survive the merge - the voice cue is added beside them, not instead.
    expect(talk?.events.filter((e) => e.type === CHANGE_SOCIAL)).toHaveLength(5);
  });

  it('leaves a clip the original authors no sound for silent', () => {
    // `viking_farmer_plant` carries no type-34 row; sowing is a quiet motion in the data.
    expect(clip('viking_farmer_plant').cues).toEqual([]);
  });
});
