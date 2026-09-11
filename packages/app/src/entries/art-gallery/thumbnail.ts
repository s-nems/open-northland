import type { GalleryEntry } from './catalog.js';

export function thumbnail(entry: GalleryEntry): HTMLElement {
  const image = document.createElement('img');
  image.src = entry.image;
  image.alt = '';
  image.loading = 'lazy';
  if (entry.kind === 'material') {
    image.className = 'thumbnail';
    return image;
  }
  const idle =
    entry.kind === 'character' ? entry.clips.find((clip) => clip.id === 'idle')?.binding : undefined;
  const frameId =
    typeof idle === 'number'
      ? idle
      : (idle?.start ?? (entry.kind === 'prop' ? entry.atlas.frames.size - 1 : 0));
  const frame = entry.atlas.frames.get(frameId);
  if (frame === undefined) throw new Error(`Gallery thumbnail frame missing: ${entry.id}`);
  const scale = 52 / Math.max(frame.width, frame.height);
  const slot = document.createElement('span');
  slot.className = 'thumbnail';
  slot.style.display = 'grid';
  slot.style.placeItems = 'center';
  slot.setAttribute('aria-hidden', 'true');
  const crop = document.createElement('span');
  crop.style.position = 'relative';
  crop.style.overflow = 'hidden';
  crop.style.width = `${frame.width * scale}px`;
  crop.style.height = `${frame.height * scale}px`;
  image.style.position = 'absolute';
  image.style.maxWidth = 'none';
  image.style.width = `${entry.atlas.width * scale}px`;
  image.style.height = `${entry.atlas.height * scale}px`;
  image.style.left = `${-frame.x * scale}px`;
  image.style.top = `${-frame.y * scale}px`;
  crop.append(image);
  slot.append(crop);
  return slot;
}
