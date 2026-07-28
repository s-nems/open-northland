import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { isCarrierJob } from '../src/hud/details-panel/model/context.js';
import type { UnitPanelModelContext } from '../src/hud/details-panel/model/index.js';

/**
 * The details panel must classify the transport trade the way the sim does — one rule, so a workshop's
 * carrier slot is excluded from its operator trades (and a carrier's experience track shows no bonus)
 * whatever typeId the running content gave that job.
 */

/** A content job row: only the id decides the trade, the atomic lanes just satisfy the row type. */
const job = (typeId: number, id: string): UnitPanelModelContext['jobs'][number] => ({
  typeId,
  id,
  allowedAtomics: [],
  baseAtomics: [],
  forbiddenAtomics: [],
});

const ctxWith = (jobs: UnitPanelModelContext['jobs']): UnitPanelModelContext => ({
  buildings: [],
  goods: [],
  jobs,
  jobExperience: [],
  tribes: [],
});

describe('the panel carrier rule', () => {
  it('follows the job id, not the typeId the content happened to assign', () => {
    const ctx = ctxWith([job(4001, 'carrier'), job(4002, 'joiner')]);

    expect(isCarrierJob(ctx, 4001)).toBe(true);
    expect(isCarrierJob(ctx, 4002)).toBe(false);
  });

  it('answers exactly what the sim predicate answers, so the two cannot drift', () => {
    const carrier = job(7, 'carrier');
    const ctx = ctxWith([carrier]);

    expect(isCarrierJob(ctx, carrier.typeId)).toBe(systems.isCarrierJobRow(carrier));
  });

  it('classifies a job the content never declared as no trade at all', () => {
    expect(isCarrierJob(ctxWith([job(1, 'carrier')]), 99)).toBe(false);
  });
});
