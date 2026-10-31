import { formatMessage, messages } from '../../../i18n/index.js';
import { type KnowledgeGood, SECONDS_PER_TICK } from '../../knowledge/base.js';
import {
  buildingsCosting,
  producersOf,
  type RecipeSource,
  rawCost,
  recipesOf,
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
  wholeText,
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

/** A recipe: inputs, an arrow, outputs and the cycle; `house` adds its workshop on a line above. */
export function recipeView(
  context: KnowledgeContext,
  recipe: KnowledgeRecipe,
  house: Child = null,
): HTMLElement {
  const inputs = goodLinks(context, recipe.inputs).flatMap((input, index) =>
    index === 0 ? [input] : [node('i', '', '+'), input],
  );
  return node(
    'div',
    'kn-recipe',
    house === null ? null : node('div', 'kn-recipe__house', house),
    node(
      'div',
      'kn-recipe__flow',
      ...inputs,
      inputs.length === 0 ? null : node('i', '', '→'),
      ...goodLinks(context, recipe.outputs),
      node('span', 'kn-recipe__time', ticksText(recipe.ticks)),
    ),
  );
}

/** The stock line and any status the seat puts on a good; empty outside a game. */
export function goodStatusBlock(context: KnowledgeContext, good: KnowledgeGood): EntryBlock | null {
  const settlement = context.settlement;
  if (settlement === null) return null;
  const chip = statusChip(settlement.status('good', good.typeId), false);
  const amount = formatMessage(copy().status.stock, { amount: wholeText(settlement.stock(good.typeId)) });
  return { node: node('div', 'kn-status', chip, node('p', 'kn-foot', amount)) };
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
  const recipe = ({ building, recipe: row }: RecipeSource): HTMLElement =>
    recipeView(context, row, buildingLink(building));
  return {
    node: section(
      title,
      ...sources.map(recipe),
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
      ...(equip.category === 'boots' ? bootEffects(context) : []),
    ];
    if (effects.length > 0) parts.push(paragraph(effects.join('. ')));
    rows.push([text.durability, equipDurability(equip)]);
  }
  if (meal !== null) {
    const { outside, home } = mealText(meal);
    rows.push([text.mealOutside, outside], [text.mealHome, home]);
  }
  return { node: section(text.effect, ...parts, factList(rows)) };
}

function bootEffects(context: KnowledgeContext): readonly string[] {
  const { base } = context;
  const tribe = context.tribe();
  const saved = stepSeconds(base, 0, tribe, false) - stepSeconds(base, 0, tribe);
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
