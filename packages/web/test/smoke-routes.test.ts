import { CONTENT_ROUTE_PROBES, isContentRoute } from '@open-northland/content-resolver';
import { describe, expect, it } from 'vitest';
import { CONTENT_ROUTES } from '../scripts/contract-routes.mjs';

describe('the image smoke check', () => {
  it('probes exactly the routes the resolver claims', () => {
    expect([...CONTENT_ROUTES].sort()).toEqual([...CONTENT_ROUTE_PROBES].sort());
  });

  it('probes paths the resolver would actually answer', () => {
    for (const route of CONTENT_ROUTES) expect(isContentRoute(route)).toBe(true);
  });
});
