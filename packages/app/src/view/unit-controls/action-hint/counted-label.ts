import type { ContentSet } from '@open-northland/data';
import { goodName } from '../../../i18n/index.js';
import { contentLookups } from '../right-click/context.js';

/** `name` with its count beside it, as the cursor label writes a heap or a chest's handout; one stands
 *  alone. */
export function countedLabel(name: string, count: number): string {
  return count > 1 ? `${name} ×${count}` : name;
}

/** A good's name by type, or its bare id for a type the content lacks. */
export function goodLabel(content: ContentSet, goodType: number): string {
  const good = contentLookups(content).goods.get(goodType);
  return good === undefined ? `#${goodType}` : goodName(good);
}
