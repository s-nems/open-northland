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
import { technologyLabel, technologyReason } from '../../game/technology.js';
import { messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';

export function openSchoolDialog(
  content: ContentSet,
  snapshot: WorldSnapshot,
  students: readonly number[],
  house: number,
  enqueue: (command: PlayerCommand) => void,
  status?: Simulation['unlockStatus'],
): (() => void) | undefined {
  const first = students[0];
  const student = first === undefined ? undefined : entityById(snapshot, first);
  if (student === undefined) return;
  const tribeId = settlerTribeOf(student);
  const tribe = content.tribes.find((t) => t.typeId === tribeId);
  if (tribe === undefined) return;
  const copy = messages().hud;
  const dialog = el(
    'dialog',
    'max-width:32rem;max-height:75vh;overflow:auto;padding:24px;background:#302719;color:#f4e6cb;border:1px solid #a18a5d',
  );
  dialog.append(el('h2', '', copy.schoolTitle), el('p', '', copy.schoolHint));
  const full = schoolFull(content, snapshot, house, students);
  const seen = new Set<string>();
  for (const requirement of tribe.jobRequirements) {
    if (requirement.requirement !== 'train') continue;
    const { target, targetId } = requirement;
    if (target === 'job' && systems.isFighterJob(content, targetId)) continue;
    const key = `${target}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      target === 'good' &&
      !tribe.jobEnables.some(
        (e) => e.kind === 'good' && e.targetId === targetId && e.jobType === settlerJobType(student),
      )
    )
      continue;
    const definition = target === 'job' ? professionDefForJob(targetId) : undefined;
    if (target === 'job' && definition === undefined) continue;
    const label = technologyLabel(content, target, targetId);
    const button = el(
      'button',
      `${BUTTON_STYLE};display:block;width:100%;margin:6px 0;text-align:left`,
      label,
    );
    const unlock = status?.(target, targetId, tribe.typeId, ownerPlayerOf(student));
    const reason = unlock === undefined ? null : technologyReason(content, unlock);
    const learned = students.every((id) =>
      settlerLearnedOf(entityById(snapshot, id)?.components ?? {}, target).includes(targetId),
    );
    const refusal = reason ?? (learned ? copy.schoolLearned : full ? copy.schoolFull : null);
    if (refusal !== null) {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.title = refusal;
    }
    button.addEventListener('click', () => {
      for (const entity of students)
        enqueue({
          kind: 'learn',
          entity: entity as Entity,
          house: house as Entity,
          target,
          typeId: targetId,
        });
      dialog.close();
    });
    dialog.append(button);
  }
  const close = el('button', BUTTON_STYLE, copy.schoolClose);
  close.addEventListener('click', () => dialog.close());
  dialog.append(close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return () => dialog.remove();
}

/** Whether the school's places are taken by students other than the ones being sent, mirroring the
 *  sim's refusal (`orders/education.ts`). */
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
