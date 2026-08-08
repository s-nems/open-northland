import { setActiveLocale } from '../../src/i18n/index.js';

/** Vitest setup for the app suite: pin the language a test reads through `currentLocale()`. Unpinned it
 *  follows the machine's, which would make every assertion on a localized label depend on the
 *  developer's system language. A test that needs the detection itself stubs `navigator` per case. */
setActiveLocale('pol');
