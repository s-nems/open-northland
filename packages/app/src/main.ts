import { installCrashCapture, logBootHeader } from './diag/index.js';
import { runEntry } from './launch.js';

/**
 * App shell entry point: reads `window.location.search` and hands off to the entry it names. All sim
 * and render wiring lives in the entries; this file only opens the first one.
 */
logBootHeader();
installCrashCapture();
// Unhandled by design: installCrashCapture's unhandledrejection hook owns the reporting.
void runEntry(new URLSearchParams(window.location.search));
