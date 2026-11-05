import { messages } from '../../../i18n/index.js';
import type { KnowledgeBuilding } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import { buildingPicture, entryPage, originBlock, paragraph, section } from './entry-parts.js';

export function renderWonder(context: KnowledgeContext, building: KnowledgeBuilding): HTMLElement {
  const text = messages().knowledge.entry;
  const stories: Readonly<Record<string, string | undefined>> = text.wonder;
  const story = stories[building.id];
  return entryPage(
    { picture: buildingPicture(context, building), title: building.name, kicker: text.kicker.wonder },
    [story === undefined ? null : { node: section(null, paragraph(story)) }, originBlock(building.help)],
  );
}
