import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import {
  components,
  type Entity,
  entityById,
  type PlayerCommand,
  type Simulation,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { professionDefForJob } from '../../catalog/professions.js';
import {
  buildingTribeOf,
  buildingTypeOf,
  ownerPlayerOf,
  type SnapshotEntity,
  settlerJobType,
  settlerLearnedOf,
  settlerTribeOf,
  trainingHouseOf,
  trainingOccupancyOf,
} from '../../game/snapshot.js';
import { technologyLabel } from '../../game/technology.js';
import { createChoiceWindow } from '../../hud/dom/choice-window.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { orderRecipients } from './action-ring/menu-state.js';

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

export function schoolChoices(
  groups: readonly SchoolGroup[],
  discovered: (course: SchoolCourse) => boolean,
): SchoolGroup[] {
  return groups.flatMap((group) => {
    const courses = group.courses.filter(discovered);
    const methods = courses.filter((course) => course.target === 'good');
    const choices = methods.length > 0 ? methods : courses.filter((course) => course.target === 'job');
    return choices.length === 0 ? [] : [{ ...group, courses: choices }];
  });
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
    if (systems.isFighterJob(content, edge.jobType) || professionDefForJob(edge.jobType) === undefined)
      continue;
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

/** The sim's `learn` rule on a snapshot learner: its current trade counts as known. */
export function knowsCourse(learner: SnapshotEntity, course: SchoolCourse): boolean {
  return systems.knowsCourse(
    {
      jobType: settlerJobType(learner) ?? null,
      learned: {
        job: settlerLearnedOf(learner.components, 'job'),
        good: settlerLearnedOf(learner.components, 'good'),
      },
    },
    course.target,
    course.typeId,
  );
}

export interface SchoolDialog {
  refresh(): void;
  setUiScale(scale: number): Promise<void>;
  dispose(): void;
}

export function schoolStudents(
  content: ContentSet,
  snapshot: WorldSnapshot,
  ids: readonly number[],
): number[] {
  return orderRecipients(content, snapshot, ids, 'assignLearningPlace').filter((id) => {
    const learner = entityById(snapshot, id);
    if (learner === undefined) return false;
    const flags = (learner.components.MissionBehaviour as { flags?: number } | undefined)?.flags ?? 0;
    return (
      !systems.isHeroJob(content, settlerJobType(learner) ?? null) &&
      (flags & components.MISSION_BEHAVIOUR.JOB_LOCKED) === 0
    );
  });
}

export function openSchoolDialog(
  content: ContentSet,
  snapshot: () => WorldSnapshot,
  students: readonly number[],
  house: number,
  enqueue: (command: PlayerCommand) => void,
  status?: Simulation['unlockStatus'],
  cue?: (cue: UiCue) => void,
  scale = 1,
): SchoolDialog | undefined {
  students = schoolStudents(content, snapshot(), students);
  const first = students[0];
  const student = first === undefined ? undefined : entityById(snapshot(), first);
  const tribeId = student === undefined ? undefined : settlerTribeOf(student);
  if (tribeId === undefined || student === undefined) return;
  const player = ownerPlayerOf(student);
  const copy = messages().hud;
  const groups = schoolGroups(content, tribeId);
  let selectedJob: number | undefined;
  let choices: SchoolGroup[] = [];
  let closed = false;
  let lastSnapshot: WorldSnapshot | undefined;
  let reasons = new Map<string, string | undefined>();
  const courseKey = (course: SchoolCourse): string => `${course.target}:${course.typeId}`;
  const dispose = (): void => {
    closed = true;
    window.dispose();
  };
  const window = createChoiceWindow({
    title: copy.schoolTitle,
    scale,
    ...(cue === undefined ? {} : { cue }),
    onDismiss: () => {
      if (selectedJob === undefined) dispose();
      else {
        selectedJob = undefined;
        refresh(true);
        if (!closed) window.show();
      }
    },
    onPick: (key) => {
      refresh(true);
      if (closed) return;
      if (selectedJob === undefined) {
        const group = choices.find((row) => String(row.jobType) === key);
        if (group === undefined) return;
        if (group.courses.length > 1) {
          selectedJob = group.jobType;
          refresh(true);
          window.show(group.label, { search: false });
          return;
        }
        const course = group.courses[0];
        if (course !== undefined) choose(course);
      } else {
        const course = choices
          .find((group) => group.jobType === selectedJob)
          ?.courses.find((row) => courseKey(row) === key);
        if (course !== undefined) choose(course);
      }
    },
  });
  const choose = (course: SchoolCourse): void => {
    if (reasons.get(courseKey(course)) !== undefined) return;
    const state = snapshot();
    for (const entity of students) {
      const learner = entityById(state, entity);
      if (learner === undefined || knowsCourse(learner, course)) continue;
      enqueue({
        kind: 'learn',
        entity: entity as Entity,
        house: house as Entity,
        target: course.target,
        typeId: course.typeId,
      });
    }
    dispose();
  };
  const refresh = (force = false): void => {
    if (closed) return;
    const state = snapshot();
    if (!force && state === lastSnapshot) return;
    lastSnapshot = state;
    const building = entityById(state, house);
    const learners = students.map((id) => entityById(state, id));
    if (building === undefined || learners.some((learner) => learner === undefined)) {
      dispose();
      return;
    }
    const valid = new Set(schoolStudents(content, state, students));
    const invalid =
      building.components.UnderConstruction !== undefined ||
      students.some((id) => !valid.has(id)) ||
      buildingTribeOf(building) !== tribeId ||
      ownerPlayerOf(building) !== player ||
      learners.some(
        (learner) =>
          learner !== undefined &&
          (settlerTribeOf(learner) !== tribeId || ownerPlayerOf(learner) !== ownerPlayerOf(building)),
      );
    const type = content.buildings.find((row) => row.typeId === buildingTypeOf(building));
    const capacity = type?.schoolSize;
    const occupied = trainingOccupancyOf(state, house);
    choices = schoolChoices(
      groups.filter((group) => status?.('job', group.jobType, tribeId, player).allowed ?? true),
      (course) => status?.(course.target, course.typeId, tribeId, player).enabled ?? true,
    );
    reasons = new Map();
    for (const group of choices)
      for (const course of group.courses) {
        const remaining = learners.filter(
          (learner) => learner !== undefined && !knowsCourse(learner, course),
        );
        const entering = remaining.filter(
          (learner) => learner !== undefined && trainingHouseOf(learner) !== house,
        ).length;
        const reason = invalid
          ? copy.schoolUnavailable
          : remaining.length === 0
            ? copy.schoolLearned
            : capacity !== undefined && occupied + entering > capacity
              ? copy.schoolFull
              : undefined;
        reasons.set(courseKey(course), reason);
      }
    const selected = choices.find((group) => group.jobType === selectedJob);
    if (selectedJob !== undefined && selected === undefined) {
      selectedJob = undefined;
      window.show();
    }
    const reasonProps = (reason: string | undefined): { reason?: string } =>
      reason === undefined ? {} : { reason };
    const rows =
      selected === undefined
        ? choices.map((group) => ({
            key: String(group.jobType),
            label: group.label,
            ...reasonProps(
              group.courses.every((course) => reasons.get(courseKey(course)) !== undefined)
                ? group.courses
                    .map((course) => reasons.get(courseKey(course)))
                    .find((reason) => reason !== undefined)
                : undefined,
            ),
          }))
        : selected.courses.map((course) => ({
            key: courseKey(course),
            label: course.label,
            ...reasonProps(reasons.get(courseKey(course))),
          }));
    window.update(
      [
        {
          label: selected === undefined ? copy.schoolProfessions : copy.choiceMethods,
          rows,
        },
      ],
      capacity === undefined
        ? ''
        : formatMessage(copy.schoolPlaces, {
            occupied,
            capacity,
          }),
    );
  };
  refresh(true);
  if (closed) return;
  window.show();
  return { refresh, setUiScale: window.setUiScale, dispose };
}
