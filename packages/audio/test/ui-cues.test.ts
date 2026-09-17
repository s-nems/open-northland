import { describe, expect, it } from 'vitest';
import { UI_CUE_FILES, UI_CUE_GAIN, uiCueShot } from '../src/index.js';

/** The engine's hardwired wavs, played centred at full gain: the GUI clicks from the input event, the
 *  rest from a lobby line or a map script. */
describe('uiCueShot', () => {
  it('plays the confirm and fail clicks centred at full gain, keyed per cue', () => {
    expect(uiCueShot('confirm')).toEqual({
      files: [UI_CUE_FILES.confirm],
      gain: UI_CUE_GAIN,
      pan: 0,
      key: 'ui:confirm',
    });
    expect(uiCueShot('fail').files).toEqual(['gui/click_fail.wav']);
    expect(uiCueShot('fail').key).not.toBe(uiCueShot('confirm').key);
  });

  it('names the lobby, briefing and earthquake wavs the engine hardwires beside the clicks', () => {
    expect(uiCueShot('chat').files).toEqual(['gui/chat_incoming.wav']);
    expect(uiCueShot('briefing').files).toEqual(['gui/briefing_popup.wav']);
    expect(uiCueShot('earthquake')).toEqual({
      files: ['misc/earthquak.wav'],
      gain: 1,
      pan: 0,
      key: 'ui:earthquake',
    });
  });
});
