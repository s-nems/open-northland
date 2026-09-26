import { type Entity, entityById, type SimEvent } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { messagesFromEvents } from '../src/hud/tool-panel/messages/from-events.js';
import type { MessageNaming } from '../src/hud/tool-panel/messages/raise.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import { inlineSessionHost } from '../src/session/index.js';

/**
 * A mirror snapshot's entity list is edited in place, so the snapshot before a tick cannot name a
 * settler the tick reaped; `SessionHost.departed()` is the host's answer, and the death card reads it.
 */

const LOCAL = 0;

const plain = (full: string): MessageText => ({ short: full, full });
const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null }),
  building: () => 'Dom',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  training: (course, subjectName, jobName) => plain(`${course}:${subjectName}:${jobName}`),
  text: (type, parts) => plain(`${parts.subjectName ?? '?'}:${type}`),
};

function sandboxSim() {
  const scene = getScene('sandbox');
  if (scene === undefined) throw new Error("no 'sandbox' scene in the registry");
  return createSceneSim(scene);
}

function died(entity: number): SimEvent {
  return { kind: 'settlerDied', entity: entity as Entity, cause: 'combat', player: LOCAL };
}

describe('inline host departed entities', () => {
  it('names a settler destroyed between two host reads on its death card', () => {
    const sim = sandboxSim();
    const host = inlineSessionHost(sim);
    sim.step();
    const before = host.snapshot();
    const settler = before.entities.find(
      (e) => e.components.Person !== undefined && e.components.Owner !== undefined,
    );
    if (settler === undefined) throw new Error('the sandbox scene spawns owned settlers');
    expect(host.departed()).toEqual([]);

    sim.world.destroy(settler.id as Entity);
    const after = host.snapshot();
    expect(entityById(after, settler.id)).toBeUndefined();
    expect(entityById(before, settler.id)).toBeUndefined(); // the same list, compacted in place
    expect(host.departed()).toEqual([settler]);
    expect(host.departed()[0]).toBe(settler);

    const [card] = messagesFromEvents([died(settler.id)], after, host.departed(), LOCAL, naming);
    expect(card?.compose().full).toBe(`S${settler.id}:${USER_MESSAGE_TYPE.humanDied}`);
  });

  it('answers the same whether the frame reads departed or the snapshot first', () => {
    const sim = sandboxSim();
    const host = inlineSessionHost(sim);
    sim.step();
    const first = host.snapshot().entities.find((e) => e.components.Person !== undefined);
    if (first === undefined) throw new Error('the sandbox scene spawns settlers');
    sim.world.destroy(first.id as Entity);
    sim.step();
    expect(host.departed()).toEqual([first]);
    expect(host.snapshot().tick).toBe(sim.tick);
    expect(host.departed()).toEqual([first]);
  });

  it('the live read names no departed entities', () => {
    const sim = sandboxSim();
    const host = inlineSessionHost(sim, { snapshots: 'live' });
    sim.step();
    const first = host.snapshot().entities.find((e) => e.components.Person !== undefined);
    if (first === undefined) throw new Error('the sandbox scene spawns settlers');
    sim.world.destroy(first.id as Entity);
    host.snapshot();
    expect(host.departed()).toEqual([]);
  });
});
