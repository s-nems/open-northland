import { describe, expect, it } from 'vitest';
import { noteIcon } from '../src/hud/tool-panel/messages/icons.js';
import {
  hitTestNotes,
  layoutMessageNotes,
  NOTE_H,
  NOTE_STRIP_ORIGIN_X,
  NOTE_STRIP_SPAN,
  NOTE_W,
  noteSpacing,
} from '../src/hud/tool-panel/messages/layout.js';
import type { UserMessage } from '../src/hud/tool-panel/messages/types.js';
import { USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';
import {
  canSelect,
  layoutMessageWindow,
  MESSAGE_WINDOW_H,
  MESSAGE_WINDOW_W,
} from '../src/hud/tool-panel/messages/window.js';

describe('message note layout', () => {
  it('stands notes one wide apart until the span fills, then packs them', () => {
    expect(noteSpacing(1)).toBe(NOTE_W);
    expect(noteSpacing(7)).toBe(NOTE_W);
    expect(noteSpacing(8)).toBe(NOTE_STRIP_SPAN / 8);
    expect(noteSpacing(0)).toBe(NOTE_W);
  });

  it('places the first note at the strip origin on the top edge, scaled', () => {
    const rects = layoutMessageNotes(2, 2);
    expect(rects).toEqual([
      { x: NOTE_STRIP_ORIGIN_X * 2, y: 0, w: NOTE_W * 2, h: NOTE_H * 2 },
      { x: (NOTE_STRIP_ORIGIN_X + NOTE_W) * 2, y: 0, w: NOTE_W * 2, h: NOTE_H * 2 },
    ]);
  });

  it('lets the later, overlapping note win the hit test', () => {
    const notes = layoutMessageNotes(10, 1).map((rect) => ({ rect }));
    const second = notes[1]?.rect;
    if (second === undefined) throw new Error('expected ten notes');
    // Inside note 1 and also inside note 0's trailing overlap.
    expect(hitTestNotes(notes, second.x + 1, 10)).toBe(1);
    expect(hitTestNotes(notes, NOTE_STRIP_ORIGIN_X + 1, 10)).toBe(0);
    expect(hitTestNotes(notes, 10, 10)).toBeNull();
    expect(hitTestNotes(notes, NOTE_STRIP_ORIGIN_X + 1, NOTE_H + 1)).toBeNull();
  });

  it('draws the settler in person except for an attack, and a token for the rest', () => {
    const settler = { kind: 'settler', entity: 1 } as const;
    expect(noteIcon(USER_MESSAGE_TYPE.wasBorn, settler)).toEqual({ kind: 'portrait' });
    expect(noteIcon(USER_MESSAGE_TYPE.humanAttacked, settler)).toEqual({
      kind: 'frame',
      name: 'message_icon_swords',
    });
    expect(noteIcon(USER_MESSAGE_TYPE.houseFinished, { kind: 'building', entity: 2 })).toEqual({
      kind: 'frame',
      name: 'message_icon_house',
    });
    expect(noteIcon(USER_MESSAGE_TYPE.humanDied, null)).toEqual({
      kind: 'frame',
      name: 'message_icon_skull',
    });
    expect(noteIcon(USER_MESSAGE_TYPE.taskFailed, null)).toBeNull();
  });
});

describe('message window layout', () => {
  it("centres the original's 440x240 window and keeps its plates inside", () => {
    const l = layoutMessageWindow(1, { width: 1000, height: 700 });
    expect(l.window).toEqual({
      x: (1000 - MESSAGE_WINDOW_W) / 2,
      y: (700 - MESSAGE_WINDOW_H) / 2,
      w: 440,
      h: 240,
    });
    expect(l.selectPlate.x).toBeGreaterThanOrEqual(l.window.x);
    expect(l.removePlate.x + l.removePlate.w).toBeLessThanOrEqual(l.window.x + l.window.w);
    expect(l.removePlate.y + l.removePlate.h).toBeLessThanOrEqual(l.window.y + l.window.h);
    expect(l.body.y).toBeGreaterThan(l.titleRect.y + l.titleRect.h);
    expect(l.body.y + l.body.h).toBeLessThanOrEqual(l.selectPlate.y);
  });

  it('offers Select only for a note that has somewhere to send the view', () => {
    const note = (over: Partial<UserMessage>): UserMessage =>
      ({
        id: 1,
        type: USER_MESSAGE_TYPE.humanDied,
        subject: null,
        at: null,
        about: null,
        goodType: null,
        jobType: null,
        priority: 0,
        tick: 0,
        text: '',
        ...over,
      }) as UserMessage;
    expect(canSelect(note({ subject: { kind: 'settler', entity: 4 } }))).toBe(true);
    expect(canSelect(note({ at: { hx: 2, hy: 4 } }))).toBe(true);
    expect(canSelect(note({ about: 2 }))).toBe(false);
  });
});
