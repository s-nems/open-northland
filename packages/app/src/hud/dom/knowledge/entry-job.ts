import { systems } from '@open-northland/sim';
import { JOB_HUNTER } from '../../../catalog/jobs.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { combatTargets, isCatapult, landed, stepSeconds } from '../../knowledge/combat.js';
import {
  type JobBlock,
  type JobFamily,
  jobBlocks,
  jobFamily,
  jobsLedTo,
  jobWeapon,
  shownJobName,
  tribeWeapons,
} from '../../knowledge/entry-blocks.js';
import {
  cadenceText,
  perSecondText,
  practiceText,
  preciseSecondsText,
  rangeText,
  secondsText,
  wholeText,
} from '../../knowledge/entry-format.js';
import type { KnowledgeJob, KnowledgeRequirement } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import {
  articleLinks,
  buildingLink,
  dataTable,
  type EntryBlock,
  entryPage,
  factList,
  filmBlock,
  foldedLinks,
  goodLink,
  links,
  node,
  paragraph,
  section,
  statusChip,
  textLink,
  weaponLink,
} from './entry-parts.js';

/** Workplaces a trade names before the rest fold. */
const WORKPLACE_LINK_LIMIT = 8;

const copy = () => messages().knowledge.entry;

function kickerOf(job: KnowledgeJob, family: JobFamily): string {
  const { kicker } = copy();
  if (family === 'hero') return kicker.hero;
  return job.needsReligion ? kicker.jobReligion : kicker.job;
}

function statusBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock | null {
  const status = context.settlement?.status('job', job.typeId);
  const chip = status === undefined ? null : statusChip(status, false);
  return chip === null ? null : { node: chip };
}

function jobFilm(context: KnowledgeContext, job: KnowledgeJob, family: JobFamily): EntryBlock | null {
  const text = copy();
  const tribe = context.tribe();
  const jobType = job.typeId;
  if (family === 'trade') {
    // A hunter's trade is his shot, which the map plays as an attack; every other trade's blow is the
    // common settler's, so a trade with no clip of its own shows none.
    const action = jobType === JOB_HUNTER ? 'attack' : 'work';
    return filmBlock(context, [{ clip: { kind: 'job', jobType, tribe, action } }]);
  }
  const weapon = jobWeapon(context.base, job, tribe);
  const step = preciseSecondsText(stepSeconds(weapon?.weight ?? 0));
  return filmBlock(context, [
    {
      clip: { kind: 'job', jobType, tribe, action: 'attack' },
      name: text.weapon.filmBlow,
      text: weapon === undefined ? '' : cadenceText(weapon),
    },
    {
      clip: { kind: 'job', jobType, tribe, action: 'walk' },
      name: text.weapon.filmMarch,
      text: formatMessage(text.weapon.filmStep, { time: step }),
    },
  ]);
}

function doesBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock {
  const text = copy().job;
  const { base } = context;
  const makes = (job.enables.good ?? []).flatMap((row) => {
    const good = base.goodByType.get(row.id);
    return good === undefined ? [] : [goodLink(context, good)];
  });
  const opens = (job.enables.house ?? []).flatMap((row) => {
    const house = base.buildingByType.get(row.id);
    return house === undefined ? [] : [buildingLink(house)];
  });
  return {
    node: section(
      text.does,
      makes.length === 0 ? null : paragraph(text.makes),
      makes.length === 0 ? null : links(makes),
      opens.length === 0 ? null : paragraph(text.opens),
      opens.length === 0 ? null : links(opens),
    ),
  };
}

function worksInBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock | null {
  const places = context.base.buildings.filter((b) => b.workers.some((w) => w.jobType === job.typeId));
  if (places.length === 0) return null;
  return {
    node: section(copy().job.worksIn, ...foldedLinks(places.map(buildingLink), WORKPLACE_LINK_LIMIT)),
    side: true,
  };
}

function practiceList(
  context: KnowledgeContext,
  need: readonly KnowledgeRequirement[],
): readonly HTMLElement[] {
  const text = copy().job;
  const name = (jobType: number): string | null => context.base.jobByType.get(jobType)?.name ?? null;
  return need.map((r) => node('li', '', node('b', '', text.practiceLabel), ' ', practiceText(r, name)));
}

function learnBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock {
  const text = copy().job;
  const need = job.requirements.filter((r) => r.route === 'need');
  const train = job.requirements.filter((r) => r.route === 'train');
  if (need.length === 0) return { node: section(text.learn, paragraph(text.fromStart)) };
  return {
    node: section(
      text.learn,
      node(
        'ul',
        'kn-steps',
        ...practiceList(context, need),
        ...train.map((r) =>
          node(
            'li',
            '',
            node('b', '', text.schoolLabel),
            ' ',
            formatMessage(text.schoolTime, { time: secondsText(r.amount) }),
          ),
        ),
      ),
    ),
  };
}

/** A soldier's weapon with what it does a second to a bare target. */
function weaponBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock | null {
  const text = copy();
  const weapon = jobWeapon(context.base, job, context.tribe());
  const bare = combatTargets(context.base)[0];
  if (weapon === undefined || bare === undefined) return null;
  return {
    node: section(
      text.job.weapon,
      factList([
        [text.job.weapon, weaponLink(context, weapon)],
        [text.strip.perSecond, perSecondText(landed(weapon, bare), weapon)],
        [text.strip.cadence, cadenceText(weapon)],
      ]),
    ),
  };
}

/** What makes a soldier a spearman or an archer: the weapon in his hand, the tribe's whole rack. */
function armsBlock(context: KnowledgeContext): EntryBlock {
  const text = copy();
  const targets = combatTargets(context.base);
  const bare = targets[0];
  const rows = tribeWeapons(context.base, context.tribe()).flatMap((weapon) => {
    if (bare === undefined || isCatapult(weapon)) return [];
    const damage = landed(weapon, bare);
    return [
      {
        label: weaponLink(context, weapon),
        cells: [{ text: wholeText(damage), heat: damage }, { text: rangeText(weapon) }],
      },
    ];
  });
  const table = dataTable(
    [{ title: text.table.weapon }, { title: text.table.perBlow }, { title: text.strip.range }],
    rows,
  );
  return { node: section(text.job.arms, paragraph(text.job.armsNote), table) };
}

function trainBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock {
  const text = copy().job;
  const barracks = context.base.buildings.filter((b) => systems.isBarracksType(b.row));
  const need = job.requirements.filter((r) => r.route === 'need' && r.experience.length > 0);
  return {
    node: section(
      text.train,
      barracks.length === 0 ? null : paragraph(text.trainAt, ' ', ...barracks.map(buildingLink)),
      need.length === 0 ? null : node('ul', 'kn-steps', ...practiceList(context, need)),
    ),
  };
}

function leadsToBlock(context: KnowledgeContext, job: KnowledgeJob): EntryBlock | null {
  const next = jobsLedTo(context.base, job);
  if (next.length === 0) return null;
  return {
    node: section(copy().job.leadsTo, links(next.map((j) => textLink(`job:${j.id}`, j.name)))),
  };
}

export function renderJob(context: KnowledgeContext, job: KnowledgeJob): HTMLElement {
  const family = jobFamily(job);
  const does = (job.enables.good?.length ?? 0) + (job.enables.house?.length ?? 0) > 0;
  const article = family === 'hero' ? 'heroes' : family === 'soldier' ? 'damage' : 'trades';
  const render = (block: JobBlock): EntryBlock | null => {
    switch (block) {
      case 'does':
        return doesBlock(context, job);
      case 'worksIn':
        return worksInBlock(context, job);
      case 'arms':
        return armsBlock(context);
      case 'weapon':
        return weaponBlock(context, job);
      case 'learn':
        return learnBlock(context, job);
      case 'train':
        return trainBlock(context, job);
      case 'leadsTo':
        return leadsToBlock(context, job);
      case 'links':
        return articleLinks(context, null, [article]);
    }
  };
  const film = jobFilm(context, job, family);
  return entryPage({ picture: null, film, title: shownJobName(job), kicker: kickerOf(job, family) }, [
    statusBlock(context, job),
    ...jobBlocks(family, { does }).map(render),
  ]);
}
