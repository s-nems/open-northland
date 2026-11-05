import { formatMessage, messages } from '../../../i18n/index.js';
import { SECONDS_PER_TICK } from '../../knowledge/base.js';
import {
  ANIMAL_TARGET,
  combatTargets,
  hitsToKill,
  landed,
  secondsForHits,
  stepSeconds,
  targetName,
} from '../../knowledge/combat.js';
import { type AnimalBlock, animalBlocks, huntWeapons } from '../../knowledge/entry-blocks.js';
import { secondsText, speedText, ticksText, wholeText } from '../../knowledge/entry-format.js';
import type { KnowledgeAnimal, KnowledgeWeapon } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import { weaponLabel } from './entry-armour.js';
import {
  articleLinks,
  dataTable,
  type EntryBlock,
  entryPage,
  factList,
  filmBlock,
  fold,
  foot,
  goodLinks,
  links,
  section,
  type TableRow,
} from './entry-parts.js';

const HEAD_PICTURE_PX = 84;

const copy = () => messages().knowledge.entry;

function huntRow(context: KnowledgeContext, animal: KnowledgeAnimal, weapon: KnowledgeWeapon): TableRow {
  const damage = landed(weapon, ANIMAL_TARGET);
  const hits = hitsToKill(damage, animal.hitpoints);
  const time = hits === null ? null : secondsForHits(hits, weapon);
  return {
    label: weaponLabel(context, weapon),
    cells: [
      { text: wholeText(damage), heat: damage },
      { text: hits === null ? '-' : String(hits) },
      { text: time === null ? '-' : secondsText(time) },
    ],
  };
}

function huntBlock(context: KnowledgeContext, animal: KnowledgeAnimal): EntryBlock {
  const text = copy();
  const { hunter, rest } = huntWeapons(context.base, context.tribe());
  const columns = [
    { title: text.table.weapon },
    { title: text.table.perBlow },
    { title: text.table.blows },
    { title: text.table.timeToKill },
  ];
  const lead =
    hunter === undefined
      ? null
      : dataTable(columns, [
          {
            ...huntRow(context, animal, hunter),
            label: hunter.jobName ?? text.animal.hunter,
          },
        ]);
  return {
    node: section(
      text.animal.hunt,
      lead,
      fold(
        text.animal.huntRest,
        dataTable(
          columns,
          rest.map((w) => huntRow(context, animal, w)),
        ),
      ),
    ),
  };
}

function attackBlock(context: KnowledgeContext, animal: KnowledgeAnimal): EntryBlock | null {
  const text = copy();
  const { weapon } = animal;
  if (weapon === null) return null;
  const striking = { id: 'animal', mainType: null, damage: weapon.damage };
  const rows = combatTargets(context.base)
    .filter((target) => target.person)
    .map((target) => {
      const damage = landed(striking, target);
      const hits = hitsToKill(damage);
      return {
        label: targetName(target),
        cells: [{ text: wholeText(damage), heat: damage }, { text: hits === null ? '-' : String(hits) }],
      };
    });
  const table = dataTable(
    [{ title: text.table.against }, { title: text.table.perBlow }, { title: text.table.blowsToKill }],
    rows,
  );
  return { node: section(text.animal.attack, table) };
}

function factsBlock(context: KnowledgeContext, animal: KnowledgeAnimal): EntryBlock {
  const text = copy().animal;
  const humanTicks = stepSeconds(0) / SECONDS_PER_TICK;
  const attacks = animal.aggressive
    ? text.attacksSelf
    : animal.getAngry
      ? text.attacksProvoked
      : text.attacksNever;
  return {
    node: section(
      text.data,
      factList([
        [text.attacks, attacks],
        [text.health, wholeText(animal.hitpoints)],
        [text.youngHealth, wholeText(animal.hitpointsYoung)],
        [text.speed, speedText(animal.moveSpeed, humanTicks)],
        ...(animal.runSpeed > 0 ? ([[text.run, speedText(animal.runSpeed, humanTicks)]] as const) : []),
        [text.herd, String(animal.groupSize)],
        [text.tame, animal.catchable ? text.yes : text.no],
        [text.hunter, animal.huntable ? text.hunterSelf : text.hunterOrder],
      ]),
    ),
    side: true,
  };
}

function animalFilm(context: KnowledgeContext, animal: KnowledgeAnimal): EntryBlock | null {
  const text = copy().animal;
  const animalTribe = animal.tribe;
  return filmBlock(
    context,
    [
      {
        clip: { kind: 'animal', animalTribe, action: 'walk' },
        name: text.filmWalk,
        text: formatMessage(copy().weapon.filmStep, { time: ticksText(animal.moveSpeed) }),
      },
      ...(animal.weapon === null
        ? []
        : [
            {
              clip: { kind: 'animal' as const, animalTribe, action: 'attack' as const },
              name: text.filmAttack,
              text: '',
            },
          ]),
    ],
    true,
  );
}

function animalPicture(context: KnowledgeContext, animal: KnowledgeAnimal): HTMLImageElement | null {
  const image = document.createElement('img');
  image.className = 'kn-animal';
  image.alt = '';
  return context.art.animalPicture(image, animal.tribe, HEAD_PICTURE_PX) ? image : null;
}

export function renderAnimal(context: KnowledgeContext, animal: KnowledgeAnimal): HTMLElement {
  const text = copy();
  const render = (block: AnimalBlock): EntryBlock | null => {
    switch (block) {
      case 'yields':
        return {
          node: section(
            text.animal.yields,
            links(goodLinks(context, animal.carcass)),
            foot(text.animal.yieldNote),
          ),
        };
      case 'facts':
        return factsBlock(context, animal);
      case 'film':
        return animalFilm(context, animal);
      case 'hunt':
        return huntBlock(context, animal);
      case 'attack':
        return attackBlock(context, animal);
      case 'links':
        return articleLinks(context, null, ['wildlife']);
    }
  };
  return entryPage(
    { picture: animalPicture(context, animal), title: animal.name, kicker: text.kicker.animal },
    animalBlocks(animal).map(render),
  );
}
