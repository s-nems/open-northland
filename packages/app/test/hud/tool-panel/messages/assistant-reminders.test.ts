import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type AssistantGrantId, GRANT_IDS } from '../../../../src/game/assistant-grant-ids.js';
import {
  type AssistantReminderSeam,
  AssistantReminders,
} from '../../../../src/hud/tool-panel/messages/assistant-reminders.js';
import { createMessageFeed, takeRaised } from '../../../../src/hud/tool-panel/messages/feed.js';
import { FightAreas } from '../../../../src/hud/tool-panel/messages/fight-areas.js';
import { type MessageNaming, MessageRaiser } from '../../../../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../../../../src/hud/tool-panel/messages/retire.js';
import { composeMessageText } from '../../../../src/hud/tool-panel/messages/text.js';
import type { IdleReason } from '../../../../src/hud/tool-panel/messages/types.js';
import { en } from '../../../../src/i18n/en.js';
import { NO_SHORTAGES } from '../../../../src/view/assistant/shortages.js';

const EXTRACTOR = 7;
const TICK = 50;

const naming: MessageNaming = {
  settler: () => ({ name: 'Olaf', jobLabel: 'Extractor', female: false }),
  building: () => 'House',
  vehicle: () => 'Cart',
  player: () => 'Player',
  stance: (state) => state,
  paper: (paper) => paper.kind,
  technology: () => undefined,
  text: (type, parts) => composeMessageText(type, parts, en.userMessages, 'en'),
};

/** A seat's assistant: the switches in `on`, the men each switch in `lacking` would dress, the goods in `stock`. */
function assistant(state: {
  on?: readonly AssistantGrantId[];
  lacking?: Partial<Record<'giveBoots' | 'giveMead' | 'giveHealingPotions', number>>;
  stock?: Readonly<Record<string, number>>;
}): { seam: AssistantReminderSeam; on: Set<AssistantGrantId> } {
  const on = new Set(state.on ?? []);
  const shortages = { ...NO_SHORTAGES };
  for (const [id, lacking] of Object.entries(state.lacking ?? {})) {
    shortages[id as 'giveBoots'] = { lacking, soldiersLacking: 0 };
  }
  return {
    on,
    seam: {
      switches: () =>
        Object.fromEntries(GRANT_IDS.map((id) => [id, on.has(id)])) as Record<AssistantGrantId, boolean>,
      shortages: () => shortages,
      stockOf: (goodId) => state.stock?.[goodId] ?? 0,
      labelOf: (id) => en.hud.assistant.switches[id].label,
    },
  };
}

const world = (flagged: boolean): WorldSnapshot => ({
  tick: TICK,
  events: [],
  entities: [{ id: EXTRACTOR, components: flagged ? { WorkFlag: {} } : {} }],
});

const PATCH_EMPTY: IdleReason = { kind: 'noResourceInArea', goodTypes: [] };

/** One sweep's reminders, with the extractor idle for `reason`. */
function swept(reminders: AssistantReminders, reason: IdleReason | null = null, flagged = true) {
  const snapshot = world(flagged);
  const raiser = new MessageRaiser(snapshot, naming);
  reminders.sweep(raiser, naming);
  const [extractor] = snapshot.entities;
  if (extractor !== undefined) reminders.idleAtFlag(raiser, naming, extractor, reason);
  return raiser.out;
}

describe('assistant reminders', () => {
  it('reminds of a give switch that is off once its good is in store and a man would take it', () => {
    const { seam } = assistant({ lacking: { giveBoots: 3 }, stock: { shoes: 1 } });
    const raised = swept(new AssistantReminders(seam));
    expect(raised.map((r) => r.pending.assistantSwitch)).toEqual(['giveBoots']);
    expect(raised[0]?.compose().short).toBe('Not issued: Shoes');
  });

  it('counts either bottle size as a potion switch stock', () => {
    const { seam } = assistant({ lacking: { giveHealingPotions: 1 }, stock: { potion_heal_small: 2 } });
    expect(swept(new AssistantReminders(seam)).map((r) => r.pending.assistantSwitch)).toEqual([
      'giveHealingPotions',
    ]);
  });

  it('stays silent while the switch is on, the store is empty or everyone is served', () => {
    const on = assistant({ on: ['giveMead'], lacking: { giveMead: 2 }, stock: { mead: 5 } });
    const empty = assistant({ lacking: { giveMead: 2 } });
    const served = assistant({ stock: { mead: 5 } });
    for (const { seam } of [on, empty, served]) expect(swept(new AssistantReminders(seam))).toEqual([]);
  });

  it('reminds of the flag follow when an extractor has nothing left by his flag', () => {
    const { seam } = assistant({});
    const raised = swept(new AssistantReminders(seam), PATCH_EMPTY);
    expect(raised.map((r) => r.pending.assistantSwitch)).toEqual(['moveFlags']);
    expect(raised[0]?.compose().full).toContain('An Extractor has nothing left to gather by his flag.');
  });

  it('leaves the flag follow alone for another reason, a worker without a flag, or the switch on', () => {
    const off = assistant({});
    expect(swept(new AssistantReminders(off.seam), { kind: 'noGame', goodTypes: [] })).toEqual([]);
    expect(swept(new AssistantReminders(off.seam), PATCH_EMPTY, false)).toEqual([]);
    const on = assistant({ on: ['moveFlags'] });
    expect(swept(new AssistantReminders(on.seam), PATCH_EMPTY)).toEqual([]);
  });

  it('keeps a dismissed reminder away while the switch stays off, and retires it once it goes on', () => {
    const { seam, on } = assistant({ lacking: { giveBoots: 3 }, stock: { shoes: 1 } });
    const reminders = new AssistantReminders(seam);
    const retirement = new NoteRetirement(new FightAreas(), null, null, null, new Set(), reminders.isOn);
    const feed = createMessageFeed();
    const pass = (): void => {
      for (const raised of swept(reminders)) takeRaised(feed, raised, TICK);
      feed.expire(TICK, (m) => retirement.isOver(m, world(true)));
    };
    pass();
    const [note] = feed.live();
    expect(note?.assistantSwitch).toBe('giveBoots');
    feed.remove(note?.id ?? -1, TICK);
    pass();
    expect(feed.live()).toEqual([]);

    on.add('giveBoots');
    pass();
    on.delete('giveBoots');
    pass();
    expect(feed.live().map((m) => m.assistantSwitch)).toEqual(['giveBoots']);
  });
});
