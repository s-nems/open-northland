export const MINIMAP_FRAMES = ['zelazo', 'ksiega', 'urnes'] as const;
export type MinimapFrame = (typeof MINIMAP_FRAMES)[number];
export const DEFAULT_MINIMAP_FRAME: MinimapFrame = 'zelazo';

/** The frame art, for a settings preview; chrome.css draws the frame itself. */
export const MINIMAP_FRAME_IMAGES: Readonly<Record<MinimapFrame, string>> = {
  zelazo: new URL('../../assets/ui/minimap/frames/zelazo.webp', import.meta.url).href,
  ksiega: new URL('../../assets/ui/minimap/frames/ksiega.webp', import.meta.url).href,
  urnes: new URL('../../assets/ui/minimap/frames/urnes.webp', import.meta.url).href,
};

export function parseMinimapFrame(value: unknown): MinimapFrame {
  return MINIMAP_FRAMES.find((frame) => frame === value) ?? DEFAULT_MINIMAP_FRAME;
}
