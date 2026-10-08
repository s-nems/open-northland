import type { UiCue, VoiceCall } from '@open-northland/audio';

/**
 * How a taken selection is acknowledged. The original confirms a single selecting click with the GUI
 * click and a drag select with nothing; our addition is a member's own voice in place of that click,
 * which a box select now also earns. A recalled control group stays silent: a key press recalls the
 * same men every time, and a voice on each press would only nag.
 */
export interface SelectionVoice {
  /** A single click took `hit` into the selection, or Shift dropped it from it. */
  readonly click: (hit: number, dropped: boolean) => void;
  /** A box select took `members`. */
  readonly box: (members: readonly number[]) => void;
}

/** Without `voices` (no sound bank) the click alone answers, as it always did. */
export function createSelectionVoice(
  voices: { readonly select: (call: VoiceCall) => void } | undefined,
  cue: (cue: UiCue) => void,
): SelectionVoice {
  return {
    click: (hit, dropped) => {
      if (dropped || voices === undefined) cue('confirm');
      else voices.select({ members: [hit], fallback: 'confirm' });
    },
    box: (members) => {
      if (members.length > 0) voices?.select({ members });
    },
  };
}
