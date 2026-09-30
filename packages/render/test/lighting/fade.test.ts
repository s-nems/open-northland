import { describe, expect, it } from 'vitest';
import { fadeGrade, LIGHT_FADE_SECONDS } from '../../src/data/lighting/fade.js';
import type { LightGrade } from '../../src/data/lighting/types.js';

const NIGHT: LightGrade = [0.56, 0.56, 0.56];
/** A render frame at 60 fps, in game seconds. */
const FRAME = 1 / 60;
const day = (): [number, number, number] => [1, 1, 1];

describe('fadeGrade', () => {
  it('closes most of the gap within the fade time and then settles exactly', () => {
    const grade = day();
    fadeGrade(grade, NIGHT, FRAME);
    expect(grade[0]).toBeLessThan(1);
    expect(grade[0]).toBeGreaterThan(0.95);
    for (let t = FRAME; t < LIGHT_FADE_SECONDS; t += FRAME) fadeGrade(grade, NIGHT, FRAME);
    expect(grade[0]).toBeLessThan(NIGHT[0] + 0.06 * (1 - NIGHT[0]));
    for (let t = 0; t < LIGHT_FADE_SECONDS; t += FRAME) fadeGrade(grade, NIGHT, FRAME);
    expect(grade).toEqual([...NIGHT]);
  });

  it('holds still while paused', () => {
    const grade = day();
    fadeGrade(grade, NIGHT, 1);
    const held = [...grade];
    fadeGrade(grade, NIGHT, 0);
    expect(grade).toEqual(held);
  });

  it('snaps on a jump or a step back', () => {
    const jumped = day();
    fadeGrade(jumped, NIGHT, 60);
    expect(jumped).toEqual([...NIGHT]);
    const rewound = day();
    fadeGrade(rewound, NIGHT, -1);
    expect(rewound).toEqual([...NIGHT]);
  });
});
