/** IPC channels between `window.ts` and the preload; the renderer only sees the preload's bridge. */
export const IS_FULLSCREEN_CHANNEL = 'window:is-fullscreen';
export const SET_FULLSCREEN_CHANNEL = 'window:set-fullscreen';
export const FULLSCREEN_CHANGED_CHANNEL = 'window:fullscreen-changed';
