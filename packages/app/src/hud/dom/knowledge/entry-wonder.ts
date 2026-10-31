import { messages } from '../../../i18n/index.js';
import type { KnowledgeBuilding } from '../../knowledge/base.js';
import type { KnowledgeContext } from './context.js';
import { buildingPicture, entryPage, originBlock, paragraph, section } from './entry-parts.js';

export function renderWonder(context: KnowledgeContext, building: KnowledgeBuilding): HTMLElement {
  const text = messages().knowledge.entry;
  return entryPage(
    { picture: buildingPicture(context, building), title: building.name, kicker: text.kicker.wonder },
    [{ node: section(text.wonder.inGame, paragraph(text.wonder.text)) }, originBlock(building.help)],
  );
}
