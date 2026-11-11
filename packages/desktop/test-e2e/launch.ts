import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication } from 'playwright';
import { CURSOR_CONFINE_ENV } from '../src/cursor/confine.js';
import { API_URL_ENV, initialGameUrl } from '../src/protocol/routing.js';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A local port nothing listens on, so no run reaches the live catalogue or bug report server. */
export const E2E_API_URL = 'http://127.0.0.1:18799';
/** The shell's first page with that server override. */
export const START_URL = initialGameUrl('app://game/index.html', E2E_API_URL);
/** The menu in English, silent and windowed; every page a test opens keeps the `api` parameter. */
export const MENU = `${START_URL}&lang=eng&sound=off&fullscreen=off`;

/** The built shell on `profile`, muted, with `env` over the test's own environment. */
export function launchShell(
  profile: string,
  env: Readonly<Record<string, string>> = {},
): Promise<ElectronApplication> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) inherited[key] = value;
  return _electron.launch({
    args: [packageRoot, `--user-data-dir=${profile}`, '--mute-audio'],
    // A test window never takes the cursor of whoever shares the machine, whatever the caller's shell set.
    env: { ...inherited, [CURSOR_CONFINE_ENV]: '0', ...env, [API_URL_ENV]: E2E_API_URL },
    timeout: 30_000,
  });
}
