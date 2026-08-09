import type { WorldRenderer } from '@open-northland/render';
import { createSoundDriver } from '../../content/audio.js';
import { loadSettlerBubbleGfx } from '../../content/bubbles.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadCombatBones } from '../../content/objects.js';

/** Load the optional decoded assets the game view's sound and combat rendering share, and return the
 *  sound driver they were loaded for. */
export async function mountGamePresentation(
  params: URLSearchParams,
  renderer: WorldRenderer,
): Promise<ReturnType<typeof createSoundDriver> | null> {
  const ir = await loadIr();
  const sound = params.get('sound') === 'off' ? null : createSoundDriver(ir);
  if (sound !== null) {
    // Browsers keep the AudioContext suspended until a gesture grants user activation: pointerdown
    // does so only for mice, so pointerup covers touch and keydown covers the keyboard.
    const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const;
    const resume = (): void => {
      void sound
        .resume()
        .then(() => {
          if (!sound.started) return;
          for (const event of GESTURE_EVENTS) window.removeEventListener(event, resume);
        })
        // Resuming can throw (e.g. a context-count cap); staying silent beats crashing the view.
        .catch(() => undefined);
    };
    for (const event of GESTURE_EVENTS) window.addEventListener(event, resume);
  }
  renderer.setCombatBonesGfx(ir !== null ? await loadCombatBones(ir) : null);
  renderer.setSettlerBubbleGfx(await loadSettlerBubbleGfx());
  renderer.setBuildingSignGfx(await loadBuildingSignGfx());
  return sound;
}
