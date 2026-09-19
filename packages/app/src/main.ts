import { installCrashCapture, logBootHeader } from './diag/index.js';
import { runEntry } from './launch.js';

/**
 * App shell entry point: reads `window.location.search` and hands off to the entry it names. All sim
 * and render wiring lives in the entries; this file only opens the first one.
 */
logBootHeader();
installCrashCapture();
// The right button is a game button everywhere, DOM overlays included: a right press that opens the
// school dialog fires `contextmenu` on the dialog, not the canvas. Capture keeps a stopped event covered.
window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
// Unhandled by design: installCrashCapture's unhandledrejection hook owns the reporting.
void runEntry(new URLSearchParams(window.location.search));
