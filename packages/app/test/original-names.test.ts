import { systems } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_BABY_FEMALE, JOB_CIVILIST, JOB_COLLECTOR, JOB_MASON, JOB_WOMAN } from '../src/catalog/jobs.js';
import type { GuiStrings } from '../src/content/gui-gfx.js';
import {
  installOriginalNames,
  installOriginalTribeNames,
  type NameContent,
  originalNameOverlay,
  originalTribeNameOverlay,
} from '../src/content/original-names.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { technologyName } from '../src/game/technology.js';
import {
  goodLabel,
  jobDisplayName,
  type UnitPanelModelContext,
} from '../src/hud/details-panel/model/context.js';
import { experienceLabel } from '../src/hud/details-panel/model/settler.js';
import { currentLocale, goodName, installNameOverlay, messages, tribeName } from '../src/i18n/index.js';

/** Synthetic tables over the sandbox rows, so no game text enters the test. */
const sandbox = sandboxContent();
const HERO_JOB = 42;
const COLLECTOR_GENERAL_TRACK = 2;
const FIST_XP = systems.FIGHT_EXPERIENCE_TYPE.FIST;
const VIKING = 1;
const DUCKS = 31;
/** A tribe the sandbox content has no row for. */
const FRANK = 2;

function typeOf(rows: readonly { readonly typeId: number; readonly id: string }[], slug: string): number {
  const row = rows.find((r) => r.id === slug);
  if (row === undefined) throw new Error(`sandbox has no ${slug}`);
  return row.typeId;
}

function jobRow(slug: string): NameContent['jobs'][number] {
  const row = sandbox.jobs.find((r) => r.id === slug);
  if (row === undefined) throw new Error(`sandbox has no job ${slug}`);
  return row;
}

/** Two vehicle jobs that share one slug, as content does for its carts and ships. */
const CART_JOB = 50;
const OXCART_JOB = 51;
const SHARED_SLUG = 'vehicle_cart';

const content: NameContent = {
  ...sandbox,
  jobs: [
    ...sandbox.jobs,
    { ...jobRow('soldier_unarmed'), typeId: HERO_JOB, id: 'hero_unarmed' },
    { ...jobRow('civilist'), typeId: CART_JOB, id: SHARED_SLUG },
    { ...jobRow('civilist'), typeId: OXCART_JOB, id: SHARED_SLUG },
  ],
  tribes: sandbox.tribes.filter((tribe) => tribe.typeId !== FRANK),
};
const WOOD = typeOf(sandbox.goods, 'wood');
const HANDCART = typeOf(sandbox.goods, 'handcart');
const HANDCART_YARD = typeOf(sandbox.buildings, 'handcart');
const SCHOOL = typeOf(sandbox.buildings, 'school');
const SPEARMAN = typeOf(sandbox.jobs, 'soldier_spear_wooden');

const strings: GuiStrings = {
  goods: { [WOOD]: 'Fixture timber', [HANDCART]: 'Fixture barrow' },
  houses: { [SCHOOL]: 'Fixture academy', [HANDCART_YARD]: 'Fixture vehicle' },
  jobs: {
    [JOB_MASON]: 'Fixture stonecutter',
    [JOB_CIVILIST]: 'Fixture commoner',
    [JOB_BABY_FEMALE]: 'Fixture infant',
    [JOB_WOMAN]: 'Fixture lady',
    [SPEARMAN]: 'Fixture pikeman',
    [HERO_JOB]: 'Fixture bare-handed champion',
    [CART_JOB]: 'Fixture barrow driver',
    [OXCART_JOB]: 'Fixture ox driver',
  },
  jobsPlural: {
    [JOB_MASON]: 'Fixture stonecutters',
    [JOB_CIVILIST]: 'Fixture commoners',
    [JOB_WOMAN]: 'Fixture ladies',
    [SPEARMAN]: 'Fixture pikemen',
  },
  experiences: { [COLLECTOR_GENERAL_TRACK]: 'Fixture gathering', [FIST_XP]: 'Fixture brawling' },
  tribes: { [VIKING]: 'Fixture northman', [FRANK]: 'Fixture westman' },
};

const ctx: UnitPanelModelContext = sandbox;

afterEach(() => {
  installNameOverlay(currentLocale(), {});
  vi.unstubAllGlobals();
});

describe('originalNameOverlay', () => {
  it('maps each table to the catalog key it names', () => {
    const names = originalNameOverlay(strings, content);
    expect(names.goods).toEqual({ wood: 'Fixture timber', handcart: 'Fixture barrow' });
    expect(names.building?.school).toBe('Fixture academy');
    expect(names.profession).toMatchObject({ mason: 'Fixture stonecutter', idle: 'Fixture commoner' });
    expect(names.roleNames).toMatchObject({ baby_female: 'Fixture infant', civilist: 'Fixture commoner' });
    expect(names.soldierClass).toEqual({ soldier_spear_wooden: 'Fixture pikeman' });
    expect(names.heroNames).toEqual({ hero_unarmed: 'Fixture bare-handed champion' });
    expect(names.trackLabels).toEqual({ collector_general: 'Fixture gathering' });
    expect(names.weaponXp).toEqual({ fist: 'Fixture brawling' });
  });

  it("names the group panel's plurals from the plural table, by the same keys as the singulars", () => {
    const names = originalNameOverlay(strings, content);
    expect(names.professions).toEqual({ mason: 'Fixture stonecutters', idle: 'Fixture commoners' });
    expect(names.soldierClasses).toEqual({ soldier_spear_wooden: 'Fixture pikemen' });
  });

  it("names the group panel's civilians and women by their jobs, as the settler panel does", () => {
    installOriginalNames(currentLocale(), strings, content);
    const copy = messages().hud.groupPanel;
    expect([copy.role.civilian, copy.roles.civilian]).toEqual([
      jobDisplayName(ctx, JOB_CIVILIST),
      'Fixture commoners',
    ]);
    expect([copy.role.woman, copy.roles.woman]).toEqual([jobDisplayName(ctx, JOB_WOMAN), 'Fixture ladies']);
    expect(copy.role.civilian).toBe('Fixture commoner');
  });

  it('names every tribe in the table, with or without a content row', () => {
    expect(originalNameOverlay(strings, content).tribeNames).toEqual({
      [VIKING]: 'Fixture northman',
      [FRANK]: 'Fixture westman',
    });
  });

  it('leaves a slug that more than one job shares to the authored catalog', () => {
    expect(originalNameOverlay(strings, content).roleNames).not.toHaveProperty(SHARED_SLUG);
  });
});

describe('installed original names', () => {
  it('replace the catalog entries they cover and leave the rest authored', () => {
    const authored = messages();
    installOriginalNames(currentLocale(), strings, content);
    const shown = messages();
    expect(shown.goods.wood).toBe('Fixture timber');
    expect(shown.goods.flour).toBe(authored.goods.flour);
    expect(shown.building.school).toBe('Fixture academy');
    expect(shown.building.barracks).toBe(authored.building.barracks);
    expect(shown.profession.carrier).toBe(authored.profession.carrier);
    expect(tribeName(VIKING)).toBe('Fixture northman');
    expect(tribeName(DUCKS, 'ducks')).toBe('ducks');
  });

  it('give the group panel plurals from the same vocabulary as the singulars', () => {
    const authored = messages().hud.groupPanel;
    installOriginalNames(currentLocale(), strings, content);
    const copy = messages().hud.groupPanel;
    expect([messages().profession.mason, copy.professions.mason]).toEqual([
      'Fixture stonecutter',
      'Fixture stonecutters',
    ]);
    expect([copy.soldierClass.soldier_spear_wooden, copy.soldierClasses.soldier_spear_wooden]).toEqual([
      'Fixture pikeman',
      'Fixture pikemen',
    ]);
    expect(copy.professions.joiner).toBe(authored.professions.joiner);
  });

  it('give notes and content good labels the same name', () => {
    installOriginalNames(currentLocale(), strings, content);
    const wood = sandbox.goods.find((g) => g.typeId === WOOD);
    if (wood === undefined) throw new Error('sandbox has no wood');
    expect(technologyName(sandbox, 'good', WOOD)).toBe('Fixture timber');
    expect(goodLabel(ctx, WOOD)).toBe('Fixture timber');
    expect(goodName(wood)).toBe('Fixture timber');
    expect(technologyName(sandbox, 'house', HANDCART_YARD)).toBe('Fixture vehicle');
  });

  it('keep the generic hero label for every hero, whatever the job is called', () => {
    installOriginalNames(currentLocale(), strings, content);
    const hero = messages().hud.groupPanel.role.hero;
    expect(technologyName(content, 'job', HERO_JOB)).toBe(hero);
    expect(jobDisplayName(content, HERO_JOB)).toBe(hero);
  });

  it("label a general experience track by the track's own name, else by its job", () => {
    const track = sandbox.jobExperience.find((t) => t.typeId === COLLECTOR_GENERAL_TRACK);
    if (track === undefined) throw new Error('sandbox has no collector track');
    expect(experienceLabel(ctx, track.typeId, track)).toBe(jobDisplayName(ctx, JOB_COLLECTOR));
    installOriginalNames(currentLocale(), strings, content);
    expect(experienceLabel(ctx, track.typeId, track)).toBe('Fixture gathering');
    expect(experienceLabel(ctx, FIST_XP, undefined)).toBe('Fixture brawling');
  });
});

describe('launch-time tribe names', () => {
  const stubStrings = (body: GuiStrings | null): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          body === null ? new Response(null, { status: 404 }) : new Response(JSON.stringify(body)),
        ),
      ),
    );
  };

  it('name every tribe before any world boots, and a booted world keeps them', async () => {
    stubStrings(strings);
    const authoredGoods = messages().goods;
    await installOriginalTribeNames(currentLocale());
    expect([tribeName(VIKING), tribeName(FRANK)]).toEqual(['Fixture northman', 'Fixture westman']);
    expect(messages().goods).toEqual(authoredGoods);

    installOriginalNames(currentLocale(), strings, content);
    expect([tribeName(VIKING), tribeName(FRANK)]).toEqual(['Fixture northman', 'Fixture westman']);
  });

  it('fetch each language once per document', async () => {
    stubStrings(strings);
    await originalTribeNameOverlay('ger');
    // Another test file may have loaded this language already, so count only the repeat's fetches.
    const fetched = vi.mocked(fetch).mock.calls.length;
    await originalTribeNameOverlay('ger');
    expect(fetch).toHaveBeenCalledTimes(fetched);
  });

  it('leave the authored names without the pipeline strings', async () => {
    stubStrings(null);
    expect(await originalTribeNameOverlay('rus')).toEqual({});
  });
});
