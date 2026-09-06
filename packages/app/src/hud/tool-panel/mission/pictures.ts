import { Texture } from 'pixi.js';
import { loadHypertextPicture } from '../../../content/gui-gfx.js';

/** Loads a page picture's texture by file name; `undefined` leaves its box empty. */
export type PictureLoader = (file: string) => Promise<Texture | undefined>;

/** The pictures one window has already asked for: a rebuild draws a settled one without a frame's gap. */
export interface PictureCache {
  /** The texture when it has already arrived; `undefined` while it is still loading or absent. */
  ready(file: string): Texture | undefined;
  load(file: string): Promise<Texture | undefined>;
}

async function fromContent(file: string): Promise<Texture | undefined> {
  const source = await loadHypertextPicture(file);
  return source === undefined ? undefined : new Texture({ source });
}

/** One texture per picture for the window's life; every rebuild would otherwise refetch each page. */
export function createPictureCache(load: PictureLoader = fromContent): PictureCache {
  const pending = new Map<string, Promise<Texture | undefined>>();
  const settled = new Map<string, Texture | undefined>();
  return {
    ready: (file) => settled.get(file),
    load(file) {
      const started =
        pending.get(file) ??
        load(file).then((texture) => {
          settled.set(file, texture);
          return texture;
        });
      pending.set(file, started);
      return started;
    },
  };
}
