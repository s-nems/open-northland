import type { MapTextLanguage } from '@open-northland/data';
import type { MissionStatus } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import type { MissionBriefSource, MissionPage, MissionReader } from '../../../src/game/map/mission-brief.js';
import { missionReader } from '../../../src/game/map/mission-brief.js';
import { mapStringLookupWithLang } from '../../../src/game/map/strings.js';
import {
  createMissionTranslator,
  type TextTranslator,
} from '../../../src/i18n/translate/mission-translate.js';

/** A translator that answers every batch with a recorded reply, one turn of the queue later. */
function stubTranslator(replies: Map<string, string>): { translator: TextTranslator; asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    translator: {
      translate: vi.fn((texts: readonly string[]) => {
        asked.push([...texts]);
        return Promise.resolve(texts.map((text) => replies.get(text) ?? text));
      }),
    },
  };
}

/** The mission reader of a Polish map read by a German player. */
function polandReader(): MissionReader {
  const page: MissionPage = {
    title: '',
    blocks: [
      { kind: 'text', style: 'title', text: 'Zadanie' },
      { kind: 'blank', lines: 1 },
      { kind: 'text', style: 'body', text: 'Zbuduj magazyn w pobliżu portu.' },
    ],
    lang: 'pol',
  };
  const fallback: MissionPage = {
    title: 'Wyspy',
    blocks: [{ kind: 'text', style: 'body', text: 'Wybrzeże pełne przygód.' }],
    lang: 'pol',
  };
  return {
    page: (id) => (id === null ? fallback : page),
    goals: () => [{ key: '0', text: 'Zdobądź zamek', emphasis: false, rule: 'authored', state: 'open' }],
    missionName: 'Wyspy',
  };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('createMissionTranslator', () => {
  it('serves the original page first, then the translation, and marks the prose language', async () => {
    const { translator } = stubTranslator(
      new Map([['Zbuduj magazyn w pobliżu portu.', 'Baue ein Lagerhaus in der Nähe des Hafens.']]),
    );
    const changes = vi.fn();
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: changes,
    });
    const reader = bridge.reader(polandReader());

    const before = reader.page(1);
    expect(before.lang).toBe('pol');
    expect(before.blocks).toEqual(polandReader().page(1).blocks);
    expect(bridge.version()).toBe(0);

    await tick();
    expect(changes).toHaveBeenCalled();

    const after = reader.page(1);
    expect(after.lang).toBe('pol'); // narration and callbacks stay the map's own
    expect(after.proseLang).toBe('de');
    expect(after.blocks).toEqual([
      { kind: 'text', style: 'title', text: 'Zadanie' },
      { kind: 'blank', lines: 1 },
      { kind: 'text', style: 'body', text: 'Baue ein Lagerhaus in der Nähe des Hafens.' },
    ]);
    bridge.dispose();
  });

  it('translates the fallback title the book prints over its chapters', async () => {
    const { translator } = stubTranslator(new Map([['Wyspy', 'Inseln']]));
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const reader = bridge.reader(polandReader());
    expect(reader.missionName).toBe('Wyspy');
    await tick();
    expect(reader.missionName).toBe('Inseln');
    bridge.dispose();
  });

  it('translates foreign goal strings, including the English table a map falls back to', async () => {
    const strings = { pol: { '1': 'Zdobądź zamek', '2': 'Angielski cel' } };
    const replies = new Map([['Zdobądź zamek', 'Erobere die Burg']]);
    const { translator } = stubTranslator(replies);
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const textOf = bridge.textOf(mapStringLookupWithLang(strings, 'ger'));
    expect(textOf(1)).toBe('Zdobądź zamek');
    await tick();
    expect(textOf(1)).toBe('Erobere die Burg');
    bridge.dispose();

    // English is the table most maps ship, so it reads translated in every other language: a
    // Traditional Chinese reader gets the English goal they fell back to translated like any other.
    const english = { eng: { '2': 'English goal' } };
    const { translator: chtTranslator } = stubTranslator(new Map([['English goal', '英文目標']]));
    const cht = createMissionTranslator({
      target: () => 'cht',
      enabled: () => true,
      translator: chtTranslator,
      onChange: () => undefined,
    });
    const chtTextOf = cht.textOf(mapStringLookupWithLang(english, 'cht'));
    expect(chtTextOf(2)).toBe('English goal');
    await tick();
    expect(chtTextOf(2)).toBe('英文目標');
    cht.dispose();
  });

  it('keeps everything as authored while the option is off', async () => {
    const { translator } = stubTranslator(new Map());
    const enabled = { on: false };
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => enabled.on,
      translator,
      onChange: () => undefined,
    });
    const reader = bridge.reader(polandReader());
    expect(reader.page(1).proseLang).toBeUndefined();
    expect(reader.page(1).blocks).toEqual(polandReader().page(1).blocks);
    await tick();
    expect(translator.translate).not.toHaveBeenCalled();
    // Turning the option on mid-game starts translating where the reader next looks.
    enabled.on = true;
    expect(reader.missionName).toBe('Wyspy');
    await tick();
    expect(translator.translate).toHaveBeenCalled();
    bridge.dispose();
  });

  it('does not queue the same text twice and never queues a failed one again', async () => {
    const failing: TextTranslator = {
      translate: vi.fn(() => Promise.reject(new Error('offline'))),
    };
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator: failing,
      onChange: () => undefined,
    });
    const textOf = bridge.textOf(mapStringLookupWithLang({ pol: { '1': 'Raz', '2': 'Dwa' } }, 'ger'));
    textOf(1);
    textOf(1);
    textOf(2);
    await tick();
    await tick();
    expect(failing.translate).toHaveBeenCalledTimes(1); // one batch for the flush, no retry loop
    bridge.dispose();
  });
});

function goalStatus(description: number, index = 0): MissionStatus {
  return {
    index,
    description,
    visible: true,
    active: true,
    done: false,
    firstFiredTick: undefined,
    lastFiredTick: undefined,
    fireCount: 0,
  };
}

describe('createMissionTranslator over the live reader', () => {
  it('re-reads the goals of a held clock when a translation lands', async () => {
    const { translator } = stubTranslator(new Map([['Zdobądź zamek', 'Erobere die Burg']]));
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const source: MissionBriefSource = {
      page: () => null,
      fallback: { title: 'Wyspy', description: 'Wybrzeże pełne przygód.', lang: 'pol' },
      skirmishGoal: null,
    };
    const reader = bridge.reader(
      missionReader(
        source,
        // The briefing holds the clock: the tick never moves while the book reads.
        { tick: () => 4, status: () => [goalStatus(300)], outcome: () => 'undecided' },
        bridge.textOf(mapStringLookupWithLang({ pol: { '300': 'Zdobądź zamek' } }, 'ger')),
        bridge.version,
      ),
    );
    expect(reader.goals()[0]?.text).toBe('Zdobądź zamek');
    await tick();
    const goals = reader.goals();
    expect(goals[0]?.text).toBe('Erobere die Burg');
    expect(goals[0]?.key).toBe('0');
    bridge.dispose();
  });

  it("keeps the author's emphasis mark out of the engine and back on the goal", async () => {
    const { translator, asked } = stubTranslator(new Map([['Skolonizuj krainę!', 'Kolonisiere das Land!']]));
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const textOf = bridge.textOf(mapStringLookupWithLang({ pol: { '9': '@Skolonizuj krainę!' } }, 'ger'));
    expect(textOf(9)).toBe('@Skolonizuj krainę!');
    await tick();
    expect(textOf(9)).toBe('@Kolonisiere das Land!');
    expect(asked[0]).toEqual(['Skolonizuj krainę!']);
    bridge.dispose();
  });
});

describe('createMissionTranslator seat names', () => {
  it("translates a localized seat name once its batch lands and passes the reader's own as it is", async () => {
    const { translator } = stubTranslator(new Map([['Wikingowie', 'Vikinger']]));
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    // A name the reader's own fallbacks answered is theirs by choice.
    expect(bridge.text({ text: 'Wikingowie', lang: null })).toBe('Wikingowie');
    expect(bridge.text({ text: 'Wikingowie', lang: 'pol' })).toBe('Wikingowie');
    await tick();
    expect(bridge.text({ text: 'Wikingowie', lang: 'pol' })).toBe('Vikinger');
    bridge.dispose();
  });

  it('keeps the seat name in its own language while the option is off', async () => {
    const { translator } = stubTranslator(new Map([['Wikingowie', 'Vikinger']]));
    const bridge = createMissionTranslator({
      target: () => 'ger',
      enabled: () => false,
      translator,
      onChange: () => undefined,
    });
    expect(bridge.text({ text: 'Wikingowie', lang: 'pol' })).toBe('Wikingowie');
    await tick();
    expect(bridge.text({ text: 'Wikingowie', lang: 'pol' })).toBe('Wikingowie');
    bridge.dispose();
  });
});

describe('createMissionTranslator target change', () => {
  /** A translator whose answers name the target they were asked for. */
  function targetAwareTranslator(answers: ReadonlyMap<string, string>): {
    translator: TextTranslator;
    asked: () => number;
  } {
    let asked = 0;
    return {
      asked: () => asked,
      translator: {
        translate: vi.fn((texts: readonly string[], _from: MapTextLanguage, to: MapTextLanguage) => {
          asked++;
          return Promise.resolve(texts.map((text) => answers.get(`${to}:${text}`) ?? text));
        }),
      },
    };
  }

  it('retargets live: the new choice answers after its batch, and each target keeps its answer', async () => {
    const { translator, asked } = targetAwareTranslator(
      new Map([
        ['ger:Wyspy', 'Inseln'],
        ['eng:Wyspy', 'Isles'],
      ]),
    );
    const changes = vi.fn();
    let choice: 'ger' | 'eng' = 'ger';
    const bridge = createMissionTranslator({
      target: () => choice,
      enabled: () => true,
      translator,
      onChange: changes,
    });
    const reader = bridge.reader(polandReader());
    expect(reader.missionName).toBe('Wyspy');
    await tick();
    expect(reader.missionName).toBe('Inseln');
    const german = bridge.version();

    // The menu picked another language: the original shows at once, and the batch for it lands into
    // the new target's own cache.
    choice = 'eng';
    expect(reader.missionName).toBe('Wyspy');
    expect(bridge.version()).toBe(german + 1);
    expect(changes).toHaveBeenCalled();
    await tick();
    expect(reader.missionName).toBe('Isles');

    // Back to German serves the kept answer without asking the engine again.
    choice = 'ger';
    expect(reader.missionName).toBe('Inseln');
    await tick();
    expect(asked()).toBe(2);
    bridge.dispose();
  });

  it("answers the original at once while the choice is the map's, and drops a pending batch", async () => {
    const { translator, asked } = targetAwareTranslator(new Map([['ger:Wyspy', 'Inseln']]));
    const changes = vi.fn();
    let choice: 'ger' | 'original' = 'ger';
    const bridge = createMissionTranslator({
      target: () => (choice === 'original' ? null : choice),
      enabled: () => true,
      translator,
      onChange: changes,
    });
    const reader = bridge.reader(polandReader());
    expect(reader.missionName).toBe('Wyspy');
    // The pick lands before the flush ran: the queued German batch is dropped, the page passes as
    // authored, and the open views learn of it through the bumped version.
    choice = 'original';
    expect(reader.missionName).toBe('Wyspy');
    await tick();
    await tick();
    expect(reader.missionName).toBe('Wyspy');
    expect(reader.page(1).proseLang).toBeUndefined();
    expect(asked()).toBe(0);
    expect(bridge.version()).toBeGreaterThan(0);
    expect(changes).toHaveBeenCalled();
    bridge.dispose();
  });

  it('retargets on demand, so a choice change bumps the version before the next read', () => {
    const { translator } = stubTranslator(new Map());
    let choice: 'ger' | 'eng' = 'ger';
    const bridge = createMissionTranslator({
      target: () => choice,
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    bridge.retarget(); // priming before the first read has nothing to drop
    expect(bridge.version()).toBe(0);
    const textOf = bridge.textOf(mapStringLookupWithLang({ pol: { '1': 'Raz' } }, 'ger'));
    expect(textOf(1)).toBe('Raz');
    choice = 'eng';
    bridge.retarget();
    expect(bridge.version()).toBe(1);
    bridge.retarget();
    expect(bridge.version()).toBe(1); // a retarget of the same answer is a no-op
    bridge.dispose();
  });
});

describe('createMissionTranslator rapid switching', () => {
  /** A translator whose batches answer only when the test settles them, one call per engine job. */
  function deferredTranslator(): {
    translator: TextTranslator;
    asked: { texts: string[]; to: MapTextLanguage }[];
    settle: (index: number, texts: readonly string[]) => void;
    fail: (index: number) => void;
  } {
    const asked: { texts: string[]; to: MapTextLanguage }[] = [];
    const pending: { resolve: (texts: readonly string[]) => void; reject: (error: Error) => void }[] = [];
    return {
      asked,
      translator: {
        translate: vi.fn((texts: readonly string[], _from: MapTextLanguage, to: MapTextLanguage) => {
          asked.push({ texts: [...texts], to });
          return new Promise<readonly string[]>((resolve, reject) => {
            pending.push({ resolve, reject });
          });
        }),
      },
      settle: (index, texts) => pending[index]?.resolve(texts),
      fail: (index) => pending[index]?.reject(new Error('engine failed')),
    };
  }

  it('does not re-order an in-flight batch when a landing rebuilds the views', async () => {
    const { translator, asked, settle } = deferredTranslator();
    let choice: 'ger' | 'eng' = 'ger';
    const bridge = createMissionTranslator({
      target: () => choice,
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const reader = bridge.reader(polandReader());

    reader.page(1); // queues the Polish texts for the German reader
    await tick();
    expect(asked.length).toBe(1); // one German batch is with the engine

    choice = 'eng'; // the user picks another language while that batch runs
    bridge.retarget();
    expect(reader.page(1).proseLang).toBe('en'); // re-derived, queued under English
    await tick();
    expect(asked.length).toBe(2);

    settle(0, ['Aufgabe', 'Baue ein Lagerhaus in der Nähe des Hafens.']); // the German batch lands…
    await tick();
    reader.page(1); // …and the landing's rebuild must NOT re-order the English texts
    expect(asked.length).toBe(2); // the English batch is still in flight; a duplicate would pile up

    settle(1, ['Task', 'Build a warehouse near the harbor.']);
    await tick();
    const after = reader.page(1);
    expect(after.proseLang).toBe('en');
    expect(after.blocks[0]).toEqual({ kind: 'text', style: 'title', text: 'Task' });

    choice = 'ger'; // switching back serves the landed German answer at once
    bridge.retarget();
    const back = reader.page(1);
    expect(back.proseLang).toBe('de');
    expect(back.blocks[0]).toEqual({ kind: 'text', style: 'title', text: 'Aufgabe' });
    expect(asked.length).toBe(2); // neither switch ordered a third engine call
    bridge.dispose();
  });

  it('retries a failed batch after the cooldown instead of pinning the original for the session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { translator, asked, fail, settle } = deferredTranslator();
      const bridge = createMissionTranslator({
        target: () => 'ger',
        enabled: () => true,
        translator,
        onChange: () => undefined,
      });
      const textOf = bridge.textOf(mapStringLookupWithLang({ pol: { '1': 'Raz' } }, 'ger'));
      expect(textOf(1)).toBe('Raz'); // original until the batch answers
      await tick();
      expect(asked.length).toBe(1);

      fail(0); // the engine rejects the batch
      await tick();
      expect(textOf(1)).toBe('Raz'); // the failed key keeps the original for now
      textOf(1);
      await tick();
      expect(asked.length).toBe(1); // and does not re-order while the cooldown runs

      vi.setSystemTime(new Date(Date.now() + 31_000)); // past the retry cooldown
      expect(textOf(1)).toBe('Raz'); // still the original until the retry answers
      await tick();
      expect(asked.length).toBe(2); // the cooldown lets the read queue again

      settle(1, ['Einmal']);
      await tick();
      expect(textOf(1)).toBe('Einmal');
      bridge.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives failed keys another chance on the next choice change at once', async () => {
    const { translator, asked, fail, settle } = deferredTranslator();
    let choice: 'ger' | 'eng' = 'ger';
    const bridge = createMissionTranslator({
      target: () => choice,
      enabled: () => true,
      translator,
      onChange: () => undefined,
    });
    const textOf = bridge.textOf(mapStringLookupWithLang({ pol: { '1': 'Raz' } }, 'ger'));
    expect(textOf(1)).toBe('Raz');
    await tick();
    fail(0);
    await tick();
    expect(textOf(1)).toBe('Raz');
    expect(asked.length).toBe(1);

    choice = 'eng'; // a choice change clears the failure record
    bridge.retarget();
    expect(textOf(1)).toBe('Raz');
    await tick();
    expect(asked.length).toBe(2);
    expect(asked[1]?.to).toBe('eng');
    settle(1, ['Once']);
    await tick();
    expect(textOf(1)).toBe('Once');
    bridge.dispose();
  });
});
