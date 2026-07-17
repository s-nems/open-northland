/**
 * Installs the culturesnation mod into the data root's `mods/` dir — the game folder stays
 * read-only, so a mod the user's install lacks lives here and reaches the pipeline via `--mod-root`.
 * The steps split by concern: `download.ts` (the culturesnation.pl → Google Drive hop chain),
 * `extract.ts` (the archive unpack), `discover.ts` (finding a `DataCnmd/` root), and `install.ts`
 * (the orchestration).
 */
export { discoverInstalledMod, findModRootUnder } from './discover.js';
export { installCnMod } from './install.js';
