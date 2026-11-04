import { describe, expect, it } from 'vitest';
import { withBuilderPosts } from '../../../../src/systems/computer-player/colony/builders.js';

const B = 'builder';
const POSTS = [B, 'fisher', B, 'wood', B] as const;

describe("a colony's builder posts", () => {
  it('keep the first ones in place and drop the tail past the sites crew', () => {
    expect(withBuilderPosts(POSTS, B, 2)).toEqual([B, 'fisher', B, 'wood']);
  });

  it('add the builders more sites call for at the end', () => {
    expect(withBuilderPosts(POSTS, B, 5)).toEqual([...POSTS, B, B]);
  });
});
