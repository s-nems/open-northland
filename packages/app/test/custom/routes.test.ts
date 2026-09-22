import { describe, expect, it } from 'vitest';
import { checkoutRoutes } from '../../src/custom/routes.js';
import { routeFor } from '../../src/routes.js';

describe('custom art routes', () => {
  it.each(['?art', '?art=gallery', '?art=gallery&map=alpha'])('routes %s to a checkout entry', (search) => {
    const route = routeFor(new URLSearchParams(search));
    expect(route.id).toBe('checkout');
    expect(checkoutRoutes).toContain(route);
  });

  it('sends the gallery and the review to different entries', () => {
    expect(routeFor(new URLSearchParams('?art=gallery'))).not.toBe(routeFor(new URLSearchParams('?art')));
  });
});
