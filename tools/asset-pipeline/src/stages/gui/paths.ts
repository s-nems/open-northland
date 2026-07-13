/**
 * The `content/gui/` subtree the GUI stage's writers (strings, cursors, manifest) all share. Kept in
 * its own module so the leaf writers and the `index.ts` orchestrator import it without a barrel cycle.
 */
export const GUI_CONTENT_DIR = 'gui';
