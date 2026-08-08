/**
 * Installs the culturesnation mod into the data root's `mods/` dir; the owned game folder stays
 * read-only, and the conversion takes the installed root as its mod root.
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { isFinalModEvent } from './events.js';
export { installCnMod } from './install.js';
