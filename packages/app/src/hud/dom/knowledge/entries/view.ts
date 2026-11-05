import { messages } from '../../../../i18n/index.js';
import { placeOf } from '../../../knowledge/entry-blocks.js';
import type { EntryRef } from '../../../knowledge/model.js';
import type { KnowledgeContext } from '../context.js';
import { renderAnimal } from './animal.js';
import { renderArmour } from './armour.js';
import { renderBuilding } from './building.js';
import { renderGood } from './good.js';
import { renderJob } from './job.js';
import { emptyEntry } from './parts.js';
import { renderTribe } from './tribe.js';
import { renderVehicle } from './vehicle.js';
import { renderWeapon } from './weapon.js';
import { renderWonder } from './wonder.js';
import './entry.css';

function pageOf(context: KnowledgeContext, ref: EntryRef): HTMLElement | null {
  const { base } = context;
  const { family, entry } = placeOf(base, ref);
  const { id } = entry;
  const render = <T>(row: T | undefined, page: (context: KnowledgeContext, row: T) => HTMLElement) =>
    row === undefined ? null : page(context, row);
  switch (family) {
    case 'good':
      return render(base.goodById.get(id), renderGood);
    case 'weapon':
      return render(base.goodById.get(id), renderWeapon);
    case 'armour':
      return render(base.goodById.get(id), renderArmour);
    case 'building':
      return render(base.buildingById.get(id), renderBuilding);
    case 'wonder':
      return render(base.buildingById.get(id), renderWonder);
    case 'job':
      return render(base.jobById.get(id), renderJob);
    case 'vehicle':
      return render(
        base.vehicles.find((v) => v.id === id),
        renderVehicle,
      );
    case 'animal':
      return render(
        base.animals.find((a) => String(a.tribe) === id),
        renderAnimal,
      );
    case 'tribe':
      return render(
        base.tribes.find((t) => String(t.typeId) === id),
        renderTribe,
      );
  }
}

/** The full entry, the same in the Encyclopedia and the tree pane; its own width decides its columns. */
export function renderEntry(context: KnowledgeContext, ref: EntryRef): HTMLElement {
  return pageOf(context, ref) ?? emptyEntry(messages().knowledge.entry.notFound);
}
