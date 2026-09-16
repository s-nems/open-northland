import { describe, expect, it } from 'vitest';
import { UI_CUE_FILES, UI_CUE_GAIN, uiCueShot } from '../src/index.js';

/** The GUI's own click feedback: two hardwired wavs, played centred at full gain from the input event. */
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
});
