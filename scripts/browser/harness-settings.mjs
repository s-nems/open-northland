// Settings every browser harness seeds before the app reads them. The browser build asks for an
// original game folder before the menu and sends `?map=` and `?relay=` there until it has one, so the
// check is marked passed. Automatic error reports go off: a Chrome driven over CDP does not report
// `navigator.webdriver`, so the app's own automation guard misses it, and a freeze during a measurement
// would otherwise file a report to the live server.

export const HARNESS_SETTINGS = { originalGameVerified: true, autoErrorReports: false };

/** Runs in the page before its scripts, so it must not close over anything; about:blank has no storage. */
export function seedStoredSettings(patch) {
  const key = 'open-northland.settings';
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  let stored = null;
  try {
    stored = JSON.parse(storage.getItem(key) ?? '{}');
  } catch {
    // A malformed blob is replaced, as the app's own parse would default it.
  }
  const settings = typeof stored === 'object' && stored !== null ? stored : {};
  storage.setItem(key, JSON.stringify({ ...settings, ...patch }));
}

/** `target` is a Playwright page or browser context. */
export function seedHarnessSettings(target) {
  return target.addInitScript(seedStoredSettings, HARNESS_SETTINGS);
}
