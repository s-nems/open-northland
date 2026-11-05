import { systems, TICKS_PER_SECOND } from '@open-northland/sim';
import { JOB_HERO_UNARMED, SOLDIER_JOB_MAX, SOLDIER_JOB_MIN } from '../../../catalog/jobs.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import type { ArticleDataBlock } from '../../knowledge/articles.js';
import { buildingHitpoints, type KnowledgeWeapon, SECONDS_PER_TICK } from '../../knowledge/base.js';
import { weaponGroups, weaponLabel } from '../../knowledge/calculator.js';
import {
  ANIMAL_TARGET,
  type BlowModifiers,
  type CombatTarget,
  clipSeconds,
  combatTargets,
  HIT_DIRECTION,
  HUMAN_HITPOINTS,
  hitsToKill,
  landed,
  perSecond,
  targetName,
} from '../../knowledge/combat.js';
import { rangeText, requirementText } from '../../knowledge/entry-format.js';
import { formatFactNumber } from '../../knowledge/facts.js';
import { goodIconMarkup } from '../good-art.js';
import { element, setStyleVar, write } from '../parts/dom.js';
import { createSegmented } from '../parts/segmented.js';
import { goLink, goodCell, plainTable } from './blocks.js';
import type { KnowledgeContext } from './context.js';

const BYZANTINE = 3;
const SECONDS_DIGITS = 1;
const MATRIX_ICON_PX = 24;
const HEAT_DIGITS = 2;

type Metric = 'damage' | 'dps' | 'hits';
const METRICS: readonly Metric[] = ['damage', 'hits', 'dps'];
const DIRECTIONS = ['front', 'backSide', 'behind'] as const;
type Direction = (typeof DIRECTIONS)[number];
const HIT_STOPS = ['0', '50', '100'] as const;
type HitStop = (typeof HIT_STOPS)[number];

interface MatrixState {
  metric: Metric;
  direction: Direction;
  hits: HitStop;
  strength: boolean;
  defense: boolean;
  heroes: boolean;
}

/** Per window, so the table's settings survive leaving the article and Wróć. */
const matrices = new WeakMap<KnowledgeContext, MatrixState>();

function matrixState(context: KnowledgeContext): MatrixState {
  const held = matrices.get(context);
  if (held !== undefined) return held;
  const fresh: MatrixState = {
    metric: 'damage',
    direction: 'front',
    hits: '0',
    strength: false,
    defense: false,
    heroes: false,
  };
  matrices.set(context, fresh);
  return fresh;
}

const blowOf = (state: MatrixState): BlowModifiers => ({
  direction: HIT_DIRECTION[state.direction],
  hits: Number(state.hits),
  strength: state.strength,
  defense: state.defense,
});

function cellValue(
  weapon: KnowledgeWeapon,
  target: CombatTarget,
  state: MatrixState,
): { readonly value: number | null; readonly text: string } {
  const damage = landed(weapon, target, blowOf(state));
  if (state.metric === 'damage') return { value: damage, text: formatFactNumber(damage) };
  if (state.metric === 'hits') {
    const hits = target.person ? hitsToKill(damage) : null;
    return hits === null ? { value: null, text: '-' } : { value: 1 / hits, text: formatFactNumber(hits) };
  }
  const rate = perSecond(damage, weapon);
  return rate === null ? { value: 0, text: '-' } : { value: rate, text: formatFactNumber(Math.round(rate)) };
}

function cadenceText(weapon: KnowledgeWeapon): string {
  const { cadence, cadenceBlows } = messages().knowledge.mechanics;
  const clip = clipSeconds(weapon);
  if (clip === null) return '-';
  const seconds = formatFactNumber(clip, SECONDS_DIGITS);
  return weapon.blows === 1
    ? formatMessage(cadence, { seconds })
    : formatMessage(cadenceBlows, { blows: weapon.blows, seconds });
}

function matrixTable(context: KnowledgeContext, state: MatrixState): HTMLElement {
  const { base, art } = context;
  const copy = messages().knowledge.mechanics;
  const targets = combatTargets(base);
  const groups = weaponGroups(base, context.tribe(), state.heroes);
  const peak = new Map(
    targets.map((target) => [
      target.id,
      Math.max(0, ...groups.flatMap((g) => g.weapons.map((w) => cellValue(w, target, state).value ?? 0))),
    ]),
  );
  const table = element('table', 'kn-table kn-table--matrix');
  const head = element('tr', '');
  const heading = (label: string, className: string): HTMLTableCellElement => {
    const cell = element('th', className);
    write(cell, label);
    return cell;
  };
  head.append(
    heading(copy.matrixWeapon, ''),
    heading(copy.matrixRange, 'kn-num kn-matrix__aux'),
    heading(copy.matrixCadence, 'kn-num kn-matrix__aux'),
  );
  for (const target of targets) {
    const cell = element('th', 'kn-num', target.good === null ? '' : goodIconMarkup(MATRIX_ICON_PX));
    const frame = cell.querySelector<HTMLElement>('.on-good__frame');
    if (frame !== null && target.good !== null) art.goodIcon(frame, target.good, MATRIX_ICON_PX);
    const name = element('span', '');
    write(name, targetName(target));
    cell.append(name);
    head.append(cell);
  }
  const thead = element('thead', '');
  thead.append(head);
  const body = element('tbody', '');
  for (const group of groups) {
    const title = element('tr', 'kn-table__group');
    const titleCell = element('th', '');
    titleCell.colSpan = targets.length + 3;
    write(titleCell, copy.weaponGroups[group.id]);
    title.append(titleCell);
    body.append(title);
    for (const weapon of group.weapons) {
      const row = element('tr', '');
      const name = heading(weaponLabel(weapon), '');
      name.scope = 'row';
      row.append(name, cellOf(rangeText(weapon)), cellOf(cadenceText(weapon)));
      for (const target of targets) {
        const { value, text } = cellValue(weapon, target, state);
        const top = peak.get(target.id) ?? 0;
        const cell = element('td', 'kn-num kn-heat');
        setStyleVar(cell, '--heat', (value === null || top === 0 ? 0 : value / top).toFixed(HEAT_DIGITS));
        write(cell, text);
        row.append(cell);
      }
      body.append(row);
    }
  }
  table.append(thead, body);
  return table;
}

function cellOf(text: string): HTMLElement {
  const cell = element('td', 'kn-num kn-dim kn-matrix__aux');
  write(cell, text);
  return cell;
}

function checkbox(label: string, on: boolean, change: (next: boolean) => void): HTMLElement {
  const host = element('label', 'kn-check');
  const box = element('input', '');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () => change(box.checked));
  host.append(box, label);
  return host;
}

function matrix(context: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  const state = matrixState(context);
  const host = element('div', 'kn-block');
  const slot = element('div', 'kn-matrix');
  const refresh = (): void => slot.replaceChildren(matrixTable(context, state));

  const metric = createSegmented(METRICS, copy.matrixShow, (key) => {
    state.metric = key;
    paint();
    refresh();
  });
  const direction = createSegmented(DIRECTIONS, copy.dialLabel, (key) => {
    state.direction = key;
    paint();
    refresh();
  });
  const hits = createSegmented(HIT_STOPS, copy.hitsLabel, (key) => {
    state.hits = key;
    paint();
    refresh();
  });
  function paint(): void {
    metric.update(
      {
        damage: { label: copy.matrixMetric.damage },
        hits: { label: copy.matrixMetric.hits },
        dps: { label: copy.matrixMetric.dps },
      },
      state.metric,
    );
    direction.update(
      {
        front: { label: copy.directions.front },
        backSide: { label: copy.directions.backSide },
        behind: { label: copy.directions.behind },
      },
      state.direction,
    );
    hits.update({ '0': { label: '0' }, '50': { label: '50' }, '100': { label: '100+' } }, state.hits);
  }
  paint();
  const field = (label: string, control: HTMLElement): HTMLElement => {
    const row = element('div', 'kn-controls__field');
    row.append(label, control);
    return row;
  };
  const controls = element('div', 'kn-controls');
  controls.append(
    field(copy.matrixShow, metric.element),
    field(copy.dialLabel, direction.element),
    field(copy.hitsLabel, hits.element),
    checkbox(copy.strengthAmulet, state.strength, (on) => {
      state.strength = on;
      refresh();
    }),
    checkbox(copy.defenseAmulet, state.defense, (on) => {
      state.defense = on;
      refresh();
    }),
    checkbox(copy.heroes, state.heroes, (on) => {
      state.heroes = on;
      refresh();
    }),
  );
  const foot = element('p', 'kn-foot');
  const animalLike = combatTargets(context.base).find((target) => target.column === ANIMAL_TARGET.column);
  write(
    foot,
    formatMessage(copy.matrixFoot, {
      hitpoints: formatFactNumber(HUMAN_HITPOINTS),
      blocking: animalLike?.blocking ?? 0,
    }),
  );
  host.append(controls, slot, foot);
  if (context.tribe() === BYZANTINE) {
    const dragon = element('p', 'kn-foot');
    write(dragon, copy.matrixDragon);
    host.append(dragon);
  }
  refresh();
  return host;
}

function armour(context: KnowledgeContext): HTMLElement {
  const { base } = context;
  const copy = messages().knowledge.mechanics;
  const rows = base.armor.flatMap((row) => {
    const good = row.goodType === null ? undefined : base.goodByType.get(row.goodType);
    return good === undefined ? [] : [[goodCell(context, good.id), row.weight]];
  });
  const blocking = base.armor.find((row) => row.blockingValue > 0)?.blockingValue ?? 0;
  return plainTable([copy.armourName, copy.armourWeight], rows, formatMessage(copy.armourFoot, { blocking }));
}

/** One school exercise; a course rounds up to whole exercises. */
const EXERCISE_TICKS = 28;
const courseSeconds = (lessons: number): number =>
  Math.ceil((lessons * TICKS_PER_SECOND) / EXERCISE_TICKS) * EXERCISE_TICKS * SECONDS_PER_TICK;

/** The value most rows share. */
function mostCommon(values: readonly number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function jobs({ base }: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  // A soldier's kind follows the weapon he takes, so the soldier jobs' requirements are left out.
  const isSoldier = (typeId: number): boolean => typeId >= SOLDIER_JOB_MIN && typeId <= SOLDIER_JOB_MAX;
  const rows = base.jobs.filter(
    (j) => j.requirements.length > 0 && j.typeId < JOB_HERO_UNARMED && !isSoldier(j.typeId),
  );
  const course = mostCommon(
    rows.flatMap((j) =>
      j.requirements.filter((r) => r.route === 'train').map((r) => courseSeconds(r.amount)),
    ),
  );
  return plainTable(
    [copy.jobName, copy.jobRequirement],
    rows.map((job) => {
      const need = job.requirements.find((r) => r.route === 'need');
      return [goLink(`job:${job.id}`, job.name), need === undefined ? '-' : requirementText(need)];
    }),
    course === undefined
      ? ''
      : formatMessage(copy.jobSchoolFoot, { seconds: formatFactNumber(course, SECONDS_DIGITS) }),
  );
}

function homes(context: KnowledgeContext): HTMLElement {
  const copy = messages().knowledge.mechanics;
  return plainTable(
    [copy.homeLevel, copy.homeFamilies, copy.homeLarder, copy.health],
    context.base.buildings
      .filter((b) => b.kind === 'home')
      .map((b) => [
        goLink(`building:${b.id}`, b.name),
        b.homeSize,
        b.stock[0]?.capacity ?? '-',
        buildingHitpoints(b, context.tribe()) ?? '-',
      ]),
  );
}

const EXPERIENCE_POINTS: readonly number[] = [1, 2, 3, 4, 5, 10, 25, 50, 100, 162];
/** Percent of experience that saves one stroke of ten. */
const PERCENT_PER_SAVED_STROKE = 20;
/** At 100% a batch yields 1.5 extra pieces, kept in tenths. */
const EXTRA_TENTHS_AT_FULL = 15;
const PERCENT = 100;
const TENTHS = 10;

function experience(): HTMLElement {
  const copy = messages().knowledge.mechanics;
  return plainTable(
    [copy.expPoints, copy.expPercent, copy.expStrokes, copy.expExtra],
    EXPERIENCE_POINTS.map((points) => {
      const percent = systems.experiencePercent(points);
      const extra = Math.trunc((percent * EXTRA_TENTHS_AT_FULL) / PERCENT) / TENTHS;
      return [
        points,
        `${percent}%`,
        Math.trunc(percent / PERCENT_PER_SAVED_STROKE),
        formatMessage(copy.expPieces, { amount: formatFactNumber(extra) }),
      ];
    }),
  );
}

const DATA_BLOCKS: Readonly<Record<ArticleDataBlock, (context: KnowledgeContext) => HTMLElement>> = {
  armour,
  experience,
  homes,
  jobs,
  matrix,
};

export function renderDataBlock(context: KnowledgeContext, name: ArticleDataBlock): HTMLElement {
  return DATA_BLOCKS[name](context);
}
