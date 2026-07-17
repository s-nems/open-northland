import { diag } from '../../src/diag/log.js';

/** Vitest setup for the app suite: silence the app-wide logger's console echo, so tests that exercise a
 *  path which legitimately warns (missing content, skipped authored rows) don't have to spy the console
 *  away. The ring still records everything, so a test can assert on `diag.entries()`. */
diag.setConsoleLevel('silent');
