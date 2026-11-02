import { formatMessage, messages } from '../../../i18n/index.js';
import { type KnowledgeGood, SECONDS_PER_TICK } from '../../knowledge/base.js';
import {
  buildingsCosting,
  producersOf,
  type RecipeSource,
  rawCost,
  recipesOf,
  recipeTicks,
  usesOf,
} from '../../knowledge/chains.js';
import { stepSeconds } from '../../knowledge/combat.js';
import { type GoodBlock, goodBlocks, rawCostAddsSteps } from '../../knowledge/entry-blocks.js';
import {
  equipDurability,
  equipEffects,
  mealText,
  preciseSecondsText,
  ticksText,
} from '../../knowledge/entry-format.js';
import type { KnowledgeRecipe } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import {
  articleLinks,
  buildingLink,
  type Child,
  type EntryBlock,
  entryPage,
  factList,
  foldedLinks,
  goodHead,
  goodLink,
  goodLinks,
  jobLink,
  links,
  node,
  originBlock,
  paragraph,
  section,
  statusChip,
} from './entry-parts.js';

/** Buildings a material names before the rest fold. */
const MATERIAL_LINK_LIMIT = 12;
const TOOL_CATEGORY = 'tool';

const copy = () => messages().knowledge.entry;

const billColumn = (context: KnowledgeContext, rows: KnowledgeRecipe['inputs']): HTMLElement => {
  const items = goodLinks(context, rows);
  return node('td', 'kn-recipes__goods', ...(items.length === 0 ? ['-'] : items));
};

/** Recipes one to a row: what goes in, an arrow, what comes out and one batch's time. A list that spans
 *  several houses names each above its rows. */
export function recipeTable(context: KnowledgeContext, sources: readonly RecipeSource[]): HTMLElement {
  const text = copy().recipe;
  const titles = [text.inputs, '', text.outputs, text.time];
  const houses = new Set(sources.map((source) => source.building.typeId)).size > 1;
  let house: number | null = null;
  const rows = sources.flatMap(({ building, recipe }) => {
    const opensHouse = houses && building.typeId !== house;
    house = building.typeId;
    const name = node('td', 'kn-recipes__house', buildingLink(building));
    name.colSpan = titles.length;
    return [
      ...(opensHouse ? [node('tr', '', name)] : []),
      node(
        'tr',
        '',
        billColumn(context, recipe.inputs),
        node('td', 'kn-recipes__arrow', '→'),
        billColumn(context, recipe.outputs),
        node(
          'td',
          'kn-recipes__time',
          ticksText(recipeTicks(context.base, building, recipe, context.tribe())),
        ),
      ),
    ];
  });
  return node(
    'table',
    'kn-recipes',
    node('thead', '', node('tr', '', ...titles.map((title) => node('th', '', title)))),
    node('tbody', '', ...rows),
  );
}

/** Any status the seat puts on a good; nothing outside a game. */
export function goodStatusBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock | null {
  const chip = context.settlement && statusChip(context.settlement.status('good', good.typeId), false);
  return chip === null ? null : { node: chip };
}

/** Every way a good comes into being. */
export function obtainBlock(
  context: KnowledgeContext,
  good: KnowledgeGood,
  title: string,
): EntryBlock | null {
  const text = copy().good;
  const sources = recipesOf(context.base, good.typeId);
  const fills = producersOf(context.base, good.typeId);
  const workers = sources.length > 0 ? [] : (context.base.gatheredBy.get(good.typeId) ?? []);
  if (sources.length === 0 && fills.length === 0 && workers.length === 0) return null;
  return {
    node: section(
      title,
      sources.length === 0 ? null : recipeTable(context, sources),
      fills.length === 0 ? null : paragraph(text.fills, ' ', links(fills.map(buildingLink))),
      workers.length === 0
        ? null
        : paragraph(
            text.gatheredBy,
            ' ',
            links(workers.map((worker) => jobLink(context, worker.jobType, worker.name))),
          ),
    ),
  };
}

function usesBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock | null {
  const text = copy().good;
  const { base } = context;
  const outputs = new Map(
    usesOf(base, good.typeId).flatMap(({ recipe }) =>
      recipe.outputs.flatMap((output) => {
        const made = base.goodByType.get(output.goodType);
        return made === undefined ? [] : [[made.typeId, made] as const];
      }),
    ),
  );
  const costs = buildingsCosting(base, good.typeId);
  const parts: Child[] = [];
  if (outputs.size > 0) {
    parts.push(
      paragraph(text.ingredient),
      links([...outputs.values()].map((made) => goodLink(context, made))),
    );
  }
  if (costs.length > 0) {
    parts.push(paragraph(text.material), ...foldedLinks(costs.map(buildingLink), MATERIAL_LINK_LIMIT));
  }
  if (parts.length === 0) {
    if (good.equip !== null || good.meal !== null) return null;
    parts.push(paragraph(text.nothing));
  }
  return { node: section(text.uses, ...parts) };
}

function effectBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock | null {
  const text = copy().good;
  const { equip, meal } = good;
  const rows: (readonly [string, Child])[] = [];
  const parts: Child[] = [];
  if (equip !== null) {
    const effects = [
      ...equipEffects(equip, (ticks) => ticks * SECONDS_PER_TICK),
      ...(equip.category === 'boots' ? bootEffects() : []),
    ];
    if (effects.length > 0) parts.push(paragraph(effects.join('. ')));
    const durability = equipDurability(equip);
    if (durability !== null) rows.push([text.durability, durability]);
  }
  if (meal !== null) {
    const { outside, home } = mealText(meal);
    rows.push([text.mealOutside, outside], [text.mealHome, home]);
  }
  return { node: section(text.effect, ...parts, rows.length === 0 ? null : factList(rows)) };
}

function bootEffects(): readonly string[] {
  const saved = stepSeconds(0, false) - stepSeconds(0);
  const text = copy().equip;
  return [formatMessage(text.step, { time: preciseSecondsText(saved) }), text.barefoot];
}

function costBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock {
  const raw = [...rawCost(context.base, good.typeId)].map(([goodType, amount]) => ({ goodType, amount }));
  return { node: section(copy().good.rawCost, links(goodLinks(context, raw))), side: true };
}

function goodArticles(good: KnowledgeGood): readonly ('food' | 'tools')[] {
  return [
    ...(good.equip?.category === TOOL_CATEGORY ? (['tools'] as const) : []),
    ...(good.meal === null ? [] : (['food'] as const)),
  ];
}

export function renderGood(context: KnowledgeContext, good: KnowledgeGood): HTMLElement {
  const text = copy();
  const render = (block: GoodBlock): EntryBlock | null => {
    switch (block) {
      case 'status':
        return goodStatusBlock(context, good);
      case 'effect':
        return effectBlock(context, good);
      case 'obtain':
        return obtainBlock(context, good, text.good.obtain);
      case 'uses':
        return usesBlock(context, good);
      case 'cost':
        return costBlock(context, good);
      case 'links':
        return articleLinks(context, { kind: 'good', id: good.id }, goodArticles(good));
      case 'origin':
        return originBlock(good.help);
    }
  };
  const kicker = good.equip === null ? text.kicker.good : text.kicker.equipment;
  const blocks = goodBlocks(good, { cost: rawCostAddsSteps(context.base, good) });
  return entryPage(goodHead(context, good, kicker), blocks.map(render));
}
