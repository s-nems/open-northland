/**
 * Installs the culturesnation mod into the data root's `mods/` dir — the game folder stays
 * read-only, so a mod the user's install lacks lives here and reaches the pipeline via `--mod-root`.
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { installCnMod } from './install.js';
