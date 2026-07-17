/**
 * Installs the culturesnation mod into the data root's `mods/` dir — the game folder stays
 * read-only, so a mod the user's install lacks lives here and reaches the pipeline via `--mod-root`.
 * The orchestration (`./install.js`) drives the culturesnation.pl → Google Drive hop chain
 * (`./download.js`) and the archive unpack (`./extract.js`), both folder-internal; finding a
 * `DataCnmd/` root (`./discover.js`) is also reachable on its own for a hand-picked folder.
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { installCnMod } from './install.js';
