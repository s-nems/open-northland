import { z } from 'zod';

const HelpTable = z.record(z.string(), z.string());

/** One language's object descriptions (`gui/help/<lang>.json`): display text by the object's type id, a
 *  line break as `\n`. Apart from the name tables so the menu does not download them at boot. */
export const ObjectHelp = z.strictObject({ goods: HelpTable, houses: HelpTable });
export type ObjectHelp = z.infer<typeof ObjectHelp>;
