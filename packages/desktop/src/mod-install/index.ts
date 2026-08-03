/**
 * Installs the culturesnation mod into the data root's `mods/` dir; the owned game folder stays
 * read-only, and the pipeline reaches the result through `--mod-root`.
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { isFinalModEvent } from './events.js';
export { installCnMod } from './install.js';
