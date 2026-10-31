import { systems } from '@open-northland/sim';
import { formatMessage, messages } from '../../../i18n/index.js';
import { combatTargets, landed, stepSeconds } from '../../knowledge/combat.js';
import {
  type JobBlock,
  type JobFamily,
  jobBlocks,
  jobFamily,
  jobsLedTo,
  jobWeapon,
} from '../../knowledge/entry-blocks.js';
import {
  cadenceText,
  perSecondText,
  practiceText,
  preciseSecondsText,
  secondsText,
} from '../../knowledge/entry-format.js';
import type { KnowledgeJob, KnowledgeRequirement } from '../../knowledge/model.js';
import type { KnowledgeContext } from './context.js';
import { weaponLabel } from './entry-armour.js';
import {
  articleLinks,
  buildingLink,
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
} from './entry-parts.js';

/** Workplaces a trade names before the rest fold. */
const WORKPLACE_LINK_LIMIT = 8;

const copy = () => messages().knowledge.entry;

function kickerOf(job: KnowledgeJob, family: JobFamily): string {
  const { kicker } = copy();
  if (family !== 'trade') return kicker[family];
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
    return filmBlock(context, [
      {
        clip: { kind: 'job', jobType, tribe, action: 'work' },
        // A hunter's trade is his shot, which the map plays as an attack.
        fallback: { kind: 'job', jobType, tribe, action: 'attack' },
        name: text.job.filmWork,
        text: '',
      },
    ]);
  }
  const weapon = jobWeapon(context.base, job, tribe);
  const step = preciseSecondsText(stepSeconds(context.base, weapon?.weight ?? 0, tribe));
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
        [text.job.weapon, weaponLabel(context, weapon)],
        [text.strip.perSecond, perSecondText(landed(weapon, bare), weapon)],
        [text.strip.cadence, cadenceText(weapon)],
      ]),
    ),
  };
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
      case 'film':
        return jobFilm(context, job, family);
      case 'does':
        return doesBlock(context, job);
      case 'worksIn':
        return worksInBlock(context, job);
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
  return entryPage({ picture: null, title: job.name, kicker: kickerOf(job, family) }, [
    statusBlock(context, job),
    ...jobBlocks(family, { does }).map(render),
  ]);
}
