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
import { ownerPlayerOf, settlerJobType, settlerTribeOf } from '../../game/snapshot.js';
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
    if (reason !== null) {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.title = reason;
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
