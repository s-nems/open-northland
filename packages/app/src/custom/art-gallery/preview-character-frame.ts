import { resolveSettlerBobId, type SpriteFrameRef } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { GalleryPreviewState } from './preview-state.js';

export function galleryCharacterFrame(
  binding: SpriteFrameRef,
  state: Pick<GalleryPreviewState, 'direction' | 'playing' | 'frame'>,
  seconds: number,
): number {
  let bob = resolveSettlerBobId(
    { idle: binding },
    {
      kind: 'settler',
      ref: 0,
      x: 0,
      y: 0,
      depth: 0,
      facing: state.direction,
    },
    seconds * TICKS_PER_SECOND,
  );
  if (!state.playing && state.frame !== undefined && typeof binding !== 'number') {
    if ('frameLists' in binding) {
      const list = binding.frameLists[state.direction];
      bob = binding.start + (list?.[state.frame % (list.length || 1)] ?? 0);
    } else {
      bob =
        binding.start + state.direction * binding.stride + (state.frame % (binding.frames ?? binding.stride));
    }
  }
  return bob;
}
