import { MAX_HALL_CHAT_LINES } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { HALL_CHAT_KEPT_MS, Hall, SEEN_KEPT_MS } from '../../../src/relay/hall/hall.js';
import { HALL_RECORD_VERSION, parseHallRecord } from '../../../src/relay/hall/record.js';

const NOW = Date.UTC(2026, 9, 25, 12);

describe('hall', () => {
  it('catches a listener up on the lines said since it last heard, wholly once some are gone', () => {
    const hall = new Hall(null, () => undefined);
    hall.say('Ania', 'heard', NOW);
    const heard = hall.said;
    for (let i = 0; i < 3; i++) hall.say('Bartek', `${i}`, NOW);
    expect(hall.history(NOW, heard)).toEqual({
      kind: 'hallChatHistory',
      lines: ['0', '1', '2'].map((text) => ({ from: 'Bartek', text, at: NOW })),
      replaces: false,
    });
    for (let i = 0; i < MAX_HALL_CHAT_LINES; i++) hall.say('Celina', `${i}`, NOW);
    expect(hall.history(NOW, heard)).toMatchObject({
      replaces: true,
      lines: { length: MAX_HALL_CHAT_LINES },
    });
  });

  it('keeps the newest chat lines within their age, oldest first', () => {
    const hall = new Hall(null, () => undefined);
    hall.say('Ania', 'stara', NOW - HALL_CHAT_KEPT_MS);
    for (let i = 0; i <= MAX_HALL_CHAT_LINES; i++) hall.say('Bartek', `${i}`, NOW - 1000 + i);
    const { lines } = hall.history(NOW, null);
    expect(lines).toHaveLength(MAX_HALL_CHAT_LINES);
    expect(lines[0]?.text).toBe('1');
    expect(lines.at(-1)?.text).toBe(String(MAX_HALL_CHAT_LINES));
    expect(new Hall(null, () => undefined).history(NOW, null).lines).toEqual([]);
  });

  it('lists each online nick once, in its room if any, and the recently gone newest first', () => {
    const hall = new Hall(null, () => undefined);
    hall.saw('Celina', NOW - SEEN_KEPT_MS);
    hall.saw('Bartek', NOW - 3000);
    hall.saw('Dawid', NOW - 2000);
    hall.saw('Ania', NOW - 1000);
    expect(
      hall.presence(
        [
          { nick: 'Ania', room: null },
          { nick: 'Ania', room: 'r1' },
          { nick: 'Emil', room: null },
        ],
        NOW,
      ),
    ).toEqual({
      kind: 'presence',
      online: [
        { nick: 'Ania', room: 'r1' },
        { nick: 'Emil', room: null },
      ],
      recent: [
        { nick: 'Dawid', at: NOW - 2000 },
        { nick: 'Bartek', at: NOW - 3000 },
      ],
    });
  });

  it('survives a restart through its record, the connected seen as of the record', () => {
    let changes = 0;
    const hall = new Hall(null, () => changes++);
    hall.say('Ania', 'hej', NOW - 5000, 'PL');
    hall.saw('Bartek', NOW - 4000);
    const record = parseHallRecord(JSON.parse(JSON.stringify(hall.record(['Ania'], NOW))));
    expect(changes).toBe(2);
    expect(record).toEqual({
      version: HALL_RECORD_VERSION,
      chat: [{ from: 'Ania', text: 'hej', at: NOW - 5000 }],
      seen: [
        { nick: 'Bartek', at: NOW - 4000 },
        { nick: 'Ania', at: NOW },
      ],
    });
    const restored = new Hall(record, () => undefined);
    expect(restored.history(NOW, null).lines).toEqual(record.chat);
    expect(restored.presence([], NOW).recent.map((player) => player.nick)).toEqual(['Ania', 'Bartek']);
  });

  it('reads only its own record version, and no line a client would refuse', () => {
    expect(() => parseHallRecord({ version: HALL_RECORD_VERSION + 1, chat: [], seen: [] })).toThrow(
      /version/,
    );
    expect(() =>
      parseHallRecord({
        version: HALL_RECORD_VERSION,
        chat: [{ from: 'Ania', text: 'a\nb', at: 1 }],
        seen: [],
      }),
    ).toThrow(/chat\[0\]\.text/);
  });
});
