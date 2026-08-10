/**
 * Installs the culturesnation mod into the data root's `mods/` dir and locates an already-installed
 * or user-picked one; the picked game source stays read-only, and the conversion takes the resulting
 * root as its mod root.
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { isFinalModEvent } from './events.js';
export { CNMOD_KNOWN_SHA256, installCnMod, type ModZipDownload } from './install.js';
