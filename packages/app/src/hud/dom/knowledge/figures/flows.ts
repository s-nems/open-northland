import { systems, TICKS_PER_MINUTE } from '@open-northland/sim';
import { formatMessage, messages } from '../../../../i18n/index.js';
import type { KnowledgeGood } from '../../../knowledge/base.js';
import { goodIconMarkup } from '../../good-art.js';
import { element } from '../../parts/dom.js';
import type { KnowledgeContext } from '../context.js';
import { number, shape } from './svg.js';

const GOOD_BOX_PX = 40;
const BUILDING_BOX_PX = 76;
const ANIMAL_BOX_PX = 52;
const YOUNG_BOX_PX = 36;

const GATHERER_JOB = 'collector';
const PORTER_JOB = 'carrier';
const FLOW_GOOD = 'wood';
const STORE_BUILDING = 'stock_00';
const BRED_ANIMAL_GOOD = 'cattle';
const ANIMAL_FARM = 'work_animal_farm';

function goodPicture(context: KnowledgeContext, goodId: string, amount: number | null = null): HTMLElement {
  const holder = element('span', 'kn-fig__good', goodIconMarkup(GOOD_BOX_PX));
  const frame = holder.querySelector<HTMLElement>('.on-good__frame');
  if (frame !== null) context.art.goodIcon(frame, goodId, GOOD_BOX_PX);
  if (amount !== null) {
    const t = messages().knowledge.figures;
    holder.append(element('span', 'kn-fig__amount', formatMessage(t.amount, { amount: number(amount) })));
  }
  return holder;
}

/** A person pictogram, the labelled stand-in for a trade: no still sprite reaches this window. */
function personPicture(withFlag: boolean): SVGElement {
  const flag = withFlag
    ? [
        shape('line', { x1: 40, y1: 40, x2: 40, y2: 6, class: 'kn-fig__post' }),
        shape('path', { d: 'M40 6l14 5-14 5z', class: 'kn-fig__sign' }),
      ]
    : [];
  return shape(
    'svg',
    { viewBox: '0 0 60 44', class: 'kn-fig__person', 'aria-hidden': 'true' },
    shape('circle', { cx: 20, cy: 10, r: 7, class: 'kn-fig__head' }),
    shape('path', { d: 'M8 42Q20 2 32 42Z', class: 'kn-fig__body' }),
    ...flag,
  );
}

function buildingPicture(context: KnowledgeContext, typeId: number, label: string): HTMLElement {
  const image = document.createElement('img');
  image.alt = '';
  image.className = 'kn-fig__thumb';
  image.style.width = `${BUILDING_BOX_PX}px`;
  if (context.art.buildingThumb(image, typeId, BUILDING_BOX_PX, context.tribe())) return image;
  return element('span', 'kn-fig__placeholder', label);
}

function animalPicture(context: KnowledgeContext, tribe: number, box: number, label: string): HTMLElement {
  const image = document.createElement('img');
  image.alt = '';
  image.className = 'kn-fig__thumb';
  image.style.width = `${box}px`;
  if (context.art.animalPicture(image, tribe, box)) return image;
  return element('span', 'kn-fig__placeholder', label);
}

function step(pictures: readonly Element[], name: string, note = ''): HTMLElement {
  const node = element('div', 'kn-fig__step');
  const picture = element('div', 'kn-fig__pictures');
  picture.append(...pictures);
  node.append(picture, element('strong', 'kn-fig__step-name'));
  const title = node.lastElementChild;
  if (title !== null) title.textContent = name;
  if (note !== '') {
    const line = element('span', 'kn-fig__step-note');
    line.textContent = note;
    node.append(line);
  }
  return node;
}

function flowArrow(label: string): HTMLElement {
  const node = element('div', 'kn-fig__flow-arrow');
  const word = element('span', 'kn-fig__step-note');
  word.textContent = label;
  node.append(
    word,
    shape(
      'svg',
      { viewBox: '0 0 36 10', 'aria-hidden': 'true' },
      shape('path', { d: 'M0 5h28', class: 'kn-fig__arrow-shaft' }),
      shape('path', { d: 'M36 5l-9-4.5v9z', class: 'kn-fig__arrow-fill' }),
    ),
  );
  return node;
}

function flow(className: string, ...parts: readonly HTMLElement[]): HTMLElement {
  const row = element('div', className);
  row.append(...parts);
  return row;
}

export function flagFlowFigure(context: KnowledgeContext): HTMLElement | null {
  const { base } = context;
  const gatherer = base.jobById.get(GATHERER_JOB);
  const porter = base.jobById.get(PORTER_JOB);
  const store = base.buildingById.get(STORE_BUILDING);
  if (gatherer === undefined || porter === undefined || store === undefined) return null;
  const t = messages().knowledge.figures.flagFlow;
  return flow(
    'kn-fig__flow kn-fig__flow--single',
    step([personPicture(true)], gatherer.name, t.atFlag),
    flowArrow(t.drops),
    step([goodPicture(context, FLOW_GOOD)], t.pile, t.pileNote),
    flowArrow(t.takes),
    step([personPicture(false)], porter.name, t.posted),
    flowArrow(t.carries),
    step([buildingPicture(context, store.typeId, store.name)], store.name),
  );
}

export function livestockCycleFigure(context: KnowledgeContext): HTMLElement | null {
  const { base } = context;
  const animal = base.goodById.get(BRED_ANIMAL_GOOD);
  const recipe = base.buildingById
    .get(ANIMAL_FARM)
    ?.recipes.find((r) => animal !== undefined && r.outputs.some((o) => o.goodType === animal.typeId));
  if (animal === undefined || recipe === undefined) return null;
  const tribe = animal.animalTribe;
  const t = messages().knowledge.figures.livestock;
  const picture = (box: number): HTMLElement =>
    tribe === null
      ? element('span', 'kn-fig__placeholder', animal.name)
      : animalPicture(context, tribe, box, animal.name);
  const good = (quantity: { readonly goodType: number; readonly amount: number }): HTMLElement[] => {
    const row: KnowledgeGood | undefined = base.goodByType.get(quantity.goodType);
    return row === undefined ? [] : [goodPicture(context, row.id, quantity.amount)];
  };
  const pair = Array.from({ length: systems.BREEDING_PAIR }, () => picture(ANIMAL_BOX_PX));
  const growMinutes = systems.ANIMAL_ADULT_AGE_TICKS / TICKS_PER_MINUTE;
  return flow(
    'kn-fig__flow',
    step(pair, formatMessage(t.pair, { count: number(systems.BREEDING_PAIR) }), t.pairNote),
    flowArrow(t.plus),
    step(recipe.inputs.flatMap(good), t.feed),
    flowArrow(t.born),
    step([picture(YOUNG_BOX_PX)], t.young, formatMessage(t.grows, { minutes: number(growMinutes) })),
    flowArrow(t.grown),
    step([picture(ANIMAL_BOX_PX)], t.adult),
    flowArrow(t.slaughter),
    step(animal.slaughterYield.flatMap(good), t.yield),
  );
}

export function homeLevelsFigure(context: KnowledgeContext): HTMLElement {
  const t = messages().knowledge.figures.homeLevels;
  const row = element('div', 'kn-fig__homes');
  for (const home of context.base.buildings.filter((b) => b.kind === 'home')) {
    row.append(
      step(
        [buildingPicture(context, home.typeId, home.name)],
        home.name,
        formatMessage(t.families, { count: number(home.homeSize) }),
      ),
    );
  }
  return row;
}
