import type { WorldRenderer } from '@open-northland/render';
import { BUILD_HOUSE_ATOMIC, HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadCombatBones } from '../../content/objects.js';

/** Load optional decoded presentation assets shared by the game view's sound and combat rendering.
 *  `hasSignArt` reports whether the `ls_temp` sign sheets resolved - the gate for door-badge click
 *  picking, whose hit geometry is the sign chain's. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
): Promise<{ sound: ReturnType<typeof createSoundDriver> | null; hasSignArt: boolean }> {
  const ir = await loadIr();
  const sound =
    params.get('sound') === 'off'
      ? null
      : createSoundDriver(ir, {
          chopAtomicId: HARVEST_ATOMIC,
          buildAtomicId: BUILD_HOUSE_ATOMIC,
        });
  if (sound !== null) {
    // The engine starts enabled; opting out is the menu's "Dźwięk w grze" setting (`?sound=off`
    // skips the driver above). Browsers keep the AudioContext suspended until a gesture that
    // grants user activation - pointerdown does only for mice, so pointerup covers touch and
    // keydown covers the keyboard. Frames before the resume drop unheard, and the listeners stay
    // hooked until a resume actually starts the context (a non-activating gesture just retries).
    const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;
    const resume = (): void => {
      void sound
        .resume()
        .then(() => {
          if (!sound.started) return;
          for (const event of GESTURE_EVENTS) window.removeEventListener(event, resume);
        })
        // Constructing/resuming the context can throw (e.g. a context-count cap) - stay silent, not crash.
        .catch(() => undefined);
    };
    for (const event of GESTURE_EVENTS) window.addEventListener(event, resume);
  }
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  const signGfx = await loadBuildingSignGfx();
  renderer.setBuildingSignGfx(signGfx);
  return { sound, hasSignArt: signGfx !== null };
}
