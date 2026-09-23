import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import {
  type Entity,
  entityById,
  type PlayerCommand,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { professionDefForJob } from '../../catalog/professions.js';
import {
  actorsOf,
  ownerPlayerOf,
  settlerJobType,
  settlerLearnedOf,
  settlerTribeOf,
  trainingHouseOf,
} from '../../game/snapshot.js';
import { technologyLabel } from '../../game/technology.js';
import { bcp47Tag, messages } from '../../i18n/index.js';
import { BUTTON_STYLE, DIALOG_STYLE, el } from '../overlay.js';

export interface SchoolCourse {
  readonly target: 'job' | 'good';
  readonly typeId: number;
  readonly label: string;
}

export interface SchoolGroup {
  readonly jobType: number;
  readonly label: string;
  readonly courses: readonly SchoolCourse[];
}

export function visibleSchoolChoices(
  groups: readonly SchoolGroup[],
  currentJob: number | undefined,
  discovered: (course: SchoolCourse) => boolean,
): { readonly methods: readonly SchoolCourse[]; readonly professions: readonly SchoolGroup[] } {
  return {
    methods:
      groups
        .find((group) => group.jobType === currentJob)
        ?.courses.filter((course) => course.target === 'good' && discovered(course)) ?? [],
    professions: groups.filter(
      (group) =>
        group.jobType !== currentJob &&
        group.courses.some((course) => course.target === 'job' && discovered(course)),
    ),
  };
}

/** Courses are grouped by the trade that uses them, with each group and its methods in display order. */
export function schoolGroups(content: ContentSet, tribeId: number): SchoolGroup[] {
  const tribe = content.tribes.find((row) => row.typeId === tribeId);
  if (tribe === undefined) return [];
  const collator = new Intl.Collator(bcp47Tag(), { sensitivity: 'base' });
  const groups = new Map<number, SchoolCourse[]>();
  const training = new Set(
    tribe.jobRequirements
      .filter((row) => row.requirement === 'train')
      .map((row) => `${row.target}:${row.targetId}`),
  );
  for (const requirement of tribe.jobRequirements) {
    if (requirement.requirement !== 'train' || requirement.target !== 'job') continue;
    const jobType = requirement.targetId;
    if (systems.isFighterJob(content, jobType) || professionDefForJob(jobType) === undefined) continue;
    const courses = groups.get(jobType) ?? [];
    if (!courses.some((course) => course.target === 'job'))
      courses.push({
        target: 'job',
        typeId: jobType,
        label: technologyLabel(content, 'job', jobType),
      });
    groups.set(jobType, courses);
  }
  for (const edge of tribe.jobEnables) {
    if (edge.kind !== 'good' || !training.has(`good:${edge.targetId}`)) continue;
    if (professionDefForJob(edge.jobType) === undefined) continue;
    const courses = groups.get(edge.jobType) ?? [];
    if (!courses.some((course) => course.target === 'good' && course.typeId === edge.targetId))
      courses.push({
        target: 'good',
        typeId: edge.targetId,
        label: technologyLabel(content, 'good', edge.targetId),
      });
    groups.set(edge.jobType, courses);
  }
  return [...groups]
    .map(([jobType, courses]) => ({
      jobType,
      label: technologyLabel(content, 'job', jobType),
      courses: courses.sort((a, b) =>
        a.target === b.target
          ? collator.compare(a.label, b.label) || a.typeId - b.typeId
          : a.target === 'job'
            ? -1
            : 1,
      ),
    }))
    .sort((a, b) => collator.compare(a.label, b.label) || a.jobType - b.jobType);
}

export function openSchoolDialog(
  content: ContentSet,
  snapshot: WorldSnapshot,
  students: readonly number[],
  house: number,
  enqueue: (command: PlayerCommand) => void,
  status?: Simulation['unlockStatus'],
  cue?: (cue: UiCue) => void,
): (() => void) | undefined {
  const first = students[0];
  const student = first === undefined ? undefined : entityById(snapshot, first);
  if (student === undefined) return;
  const tribeId = settlerTribeOf(student);
  const tribe = content.tribes.find((row) => row.typeId === tribeId);
  if (tribe === undefined) return;
  const copy = messages().hud;
  const dialog = el(
    'dialog',
    `${DIALOG_STYLE};padding:10px;width:min(28rem,calc(100vw - 24px));box-sizing:border-box;max-height:70vh;overflow:auto`,
  );
  const header = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px');
  header.append(el('h2', 'font-size:17px;margin:0', copy.schoolTitle));
  const close = el('button', `${BUTTON_STYLE};padding:2px 7px;font-size:16px`, '×');
  close.title = copy.schoolClose;
  close.setAttribute('aria-label', copy.schoolClose);
  close.addEventListener('click', () => {
    cue?.('confirm');
    dialog.close();
  });
  header.append(close);
  dialog.append(header);
  const full = schoolFull(content, snapshot, house, students);
  const learners = students.map((id) => entityById(snapshot, id));
  const wrongTribe = learners.some((learner) => learner === undefined || settlerTribeOf(learner) !== tribeId);
  const currentJob = learners.every(
    (learner) => learner !== undefined && settlerJobType(learner) === settlerJobType(student),
  )
    ? settlerJobType(student)
    : undefined;
  const groups = schoolGroups(content, tribe.typeId);
  const choices = visibleSchoolChoices(
    groups,
    currentJob,
    (course) => status?.(course.target, course.typeId, tribe.typeId, ownerPlayerOf(student)).enabled ?? true,
  );
  const addButton = (grid: HTMLElement, course: SchoolCourse, label: string): void => {
    const button = el(
      'button',
      `${BUTTON_STYLE};min-height:26px;padding:3px 6px;text-align:left;line-height:1.15`,
      label,
    );
    button.title = label;
    const learned = learners.every(
      (learner) =>
        learner !== undefined && settlerLearnedOf(learner.components, course.target).includes(course.typeId),
    );
    let refusal: string | null = null;
    if (wrongTribe) refusal = copy.schoolWrongTribe;
    else if (learned) refusal = copy.schoolLearned;
    else if (full) refusal = copy.schoolFull;
    if (refusal !== null) {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.title = `${label}: ${refusal}`;
      button.setAttribute('aria-label', button.title);
    }
    button.addEventListener('click', () => {
      cue?.('confirm');
      for (const entity of students)
        enqueue({
          kind: 'learn',
          entity: entity as Entity,
          house: house as Entity,
          target: course.target,
          typeId: course.typeId,
        });
      dialog.close();
    });
    grid.append(button);
  };
  const addSection = (title: string): HTMLElement => {
    const section = el('section', 'margin:7px 0 0');
    section.append(el('h3', 'font-size:12px;margin:0 0 4px', title));
    const grid = el('div', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px');
    section.append(grid);
    dialog.append(section);
    return grid;
  };
  if (choices.methods.length > 0) {
    const grid = addSection(groups.find((group) => group.jobType === currentJob)?.label ?? copy.schoolTitle);
    for (const method of choices.methods) addButton(grid, method, method.label);
  }
  if (choices.professions.length > 0) {
    const grid = addSection(copy.schoolProfessions);
    for (const group of choices.professions) {
      const course = group.courses.find((row) => row.target === 'job');
      if (course !== undefined) addButton(grid, course, group.label);
    }
  }
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return () => dialog.remove();
}

function schoolFull(
  content: ContentSet,
  snapshot: WorldSnapshot,
  house: number,
  students: readonly number[],
): boolean {
  const building = entityById(snapshot, house);
  const buildingType = (building?.components.Building as { buildingType?: unknown } | undefined)
    ?.buildingType;
  const size = content.buildings.find((b) => b.typeId === buildingType)?.schoolSize;
  if (size === undefined) return false;
  let occupied = 0;
  for (const e of actorsOf(snapshot)) {
    if (trainingHouseOf(e) === house && !students.includes(e.id)) occupied++;
  }
  return occupied >= size;
}
