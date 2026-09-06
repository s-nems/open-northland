/** Its own module so the GUI leaf writers and the `index.ts` orchestrator share it without a barrel cycle. */
export const GUI_CONTENT_DIR = 'gui';
/** The subtree hypertext page pictures are emitted into, served at `/gui/hypertext/`. */
export const HYPERTEXT_PICTURES_DIR = `${GUI_CONTENT_DIR}/hypertext`;
/** The languages the GUI text outputs ship in. */
export const GUI_LANGS = ['eng', 'pol'] as const;
