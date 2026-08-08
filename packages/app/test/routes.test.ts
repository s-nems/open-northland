import { describe, expect, it } from 'vitest';
import { type RouteId, routeFor } from '../src/routes.js';

/**
 * The URL dispatch decision alone. Awaiting the `load()` thunks would work but costs roughly ten
 * seconds of Vitest transform, and `tsc --build` already proves each specifier resolves to a module
 * whose export fits `EntryRunner`. Neither proves an id names the module it claims, which is what the
 * manual boot pass over each URL mode covers.
 */

const idFor = (search: string): RouteId => routeFor(new URLSearchParams(search)).id;

describe('routeFor', () => {
  it('sends a URL with no mode flag to the menu', () => {
    expect(idFor('')).toBe('menu');
    expect(idFor('?locale=pol')).toBe('menu');
  });

  it.each<[string, RouteId]>([
    ['?shot', 'shot'],
    ['?backdrop', 'backdrop'],
    ['?scene=battle', 'scene'],
    ['?anim', 'anim'],
    ['?icons', 'icons'],
    ['?sounds', 'sounds'],
    ['?map=alpha', 'map'],
  ])('routes %s to the %s entry', (search, id) => {
    expect(idFor(search)).toBe(id);
  });

  it('treats a valueless scene flag as the scene entry, which reports the unknown id', () => {
    expect(idFor('?scene')).toBe('scene');
    expect(idFor('?scene=')).toBe('scene');
  });

  it('resolves overlapping flags by table order', () => {
    expect(idFor('?shot&map=alpha')).toBe('shot');
    expect(idFor('?scene=battle&anim')).toBe('scene');
    expect(idFor('?icons&map=alpha')).toBe('icons');
  });
});
