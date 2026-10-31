// The live tables a Mechaniki article embeds with `{ data: 'name' }`. They read game data, so an article
// never retypes a number the data already owns.
import { goodCell, plainTable } from './blocks.js';
import {
  BLOCKING_VALUE,
  cadenceText,
  HUMAN_HITPOINTS,
  hitsToKill,
  landed,
  perSecond,
  perSecondText,
  stepSeconds,
  TARGETS,
} from './combat.js';
import { buildingHitpoints, data, esc, goodById, goodIcon, number, precise, seconds } from './model.js';

const BYZANTINE = 3;
const WEAPON_NAME = {
  fist: 'Pięści',
  woman_fist: 'Pięści kobiety',
  house_bow: 'Strzały z budynku',
  hunter_bow: 'Łuk myśliwego',
  catapult: 'Katapulta',
};
const SOLDIER_ORDER = [
  'fist',
  'wooden_spear',
  'iron_spear',
  'short_sword',
  'long_sword',
  'short_bow',
  'long_bow',
  'catapult',
];
const CIVILIAN_ORDER = ['woman_fist', 'hunter_bow', 'house_bow'];

function cellValue(weapon, target, m, metric) {
  const damage = landed(weapon, target, m);
  if (metric === 'damage') return { value: damage, text: number(damage) };
  if (metric === 'hits') {
    if (!target.person) return { value: null, text: '-' };
    const hits = hitsToKill(damage);
    return { value: hits === null ? null : 1 / hits, text: hits ?? '-' };
  }
  return { value: perSecond(damage, weapon) ?? 0, text: perSecondText(damage, weapon) };
}

function segmented(name, options, value) {
  return `<div class="on-segmented">${options.map(([v, t]) => `<button aria-pressed="${String(v) === String(value)}" data-matrix="${name}:${v}">${t}</button>`).join('')}</div>`;
}

function matrixRows(rows, group, m, peaks) {
  const cells = rows.map((weapon) => {
    const name = WEAPON_NAME[weapon.id] ?? weapon.goodName ?? weapon.jobName ?? weapon.id;
    const label = weapon.id.startsWith('hero_') ? weapon.jobName : name;
    const tds = TARGETS.map((target) => {
      const { value, text } = cellValue(weapon, target, m, m.metric);
      const heat = value === null || peaks[target.key] === 0 ? 0 : value / peaks[target.key];
      return `<td class="kn-num kn-heat" style="--heat:${heat.toFixed(2)}">${text}</td>`;
    }).join('');
    return `<tr><th scope="row">${esc(label)}</th><td class="kn-num kn-dim">${weapon.minRange === weapon.maxRange ? weapon.maxRange : `${weapon.minRange}-${weapon.maxRange}`}</td><td class="kn-num kn-dim">${cadenceText(weapon)}</td>${tds}</tr>`;
  });
  return `<tr class="kn-table__group"><th colspan="${TARGETS.length + 3}">${group}</th></tr>${cells.join('')}`;
}

function matrix(state) {
  const m = state.matrix;
  const weapons = data.weapons[state.tribe].filter((w) => w.usable);
  const pick = (ids) => ids.map((id) => weapons.find((w) => w.id === id)).filter(Boolean);
  const soldiers = pick(SOLDIER_ORDER);
  const civilians = pick(CIVILIAN_ORDER);
  const heroes = weapons.filter((w) => w.id.startsWith('hero_'));
  const shown = [...soldiers, ...civilians, ...(m.heroes ? heroes : [])];
  const peaks = {};
  for (const target of TARGETS) {
    peaks[target.key] = Math.max(0, ...shown.map((w) => cellValue(w, target, m, m.metric).value ?? 0));
  }
  const heads = TARGETS.map((t) => {
    const good = t.good === undefined ? null : goodById.get(t.good);
    return `<th class="kn-num">${good === null ? '' : goodIcon(good)}<span>${t.name}</span></th>`;
  }).join('');
  return `<div class="kn-controls">
      <label>Pokaż ${segmented(
        'metric',
        [
          ['damage', 'Obrażenia'],
          ['hits', 'Ciosy do śmierci'],
          ['dps', 'Na sekundę'],
        ],
        m.metric,
      )}</label>
      <label>Skąd cios ${segmented(
        'direction',
        [
          [100, 'Przód'],
          [125, 'Bok z tyłu ×1,25'],
          [150, 'Tył ×1,5'],
        ],
        m.direction,
      )}</label>
      <label>Trafienia ${segmented(
        'hits',
        [
          [0, '0'],
          [50, '50'],
          [100, '100+'],
        ],
        m.hits,
      )}</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="strength" ${m.strength ? 'checked' : ''}> Amulet Siły u atakującego</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="defense" ${m.defense ? 'checked' : ''}> Amulet Obrony u celu</label>
      <label class="kn-check"><input type="checkbox" data-matrix-check="heroes" ${m.heroes ? 'checked' : ''}> Bohaterowie</label>
    </div>
    <table class="kn-table kn-table--matrix">
      <thead><tr><th>Broń</th><th class="kn-num">Zasięg</th><th class="kn-num">Cios co</th>${heads}</tr></thead>
      <tbody>${matrixRows(soldiers, 'Wojsko', m, peaks)}${matrixRows(civilians, 'Cywile i budynki', m, peaks)}${m.heroes ? matrixRows(heroes, 'Bohaterowie', m, peaks) : ''}</tbody>
    </table>
    <p class="kn-foot">Człowiek ma ${number(HUMAN_HITPOINTS)} zdrowia. Zwierzę liczy się jak skórzana zbroja. Wybór plemienia w pasku zmienia wiersze.</p>
    ${state.tribe === BYZANTINE ? '<p class="kn-foot">Drewniana włócznia pokazuje tu smoka z mapy. Wyszkolony Bizantyjczyk walczy zwykłą drewnianą włócznią, okno rozróżni te dwie postacie.</p>' : ''}`;
}

const ARMOUR_GOOD = ['armor_wool', 'armor_leather', 'armor_chain', 'armor_plate'];

function armour(state) {
  return plainTable(
    ['Pancerz', 'Blokada', 'Ciężar', 'Krok w butach na lądzie'],
    data.armor.map((a) => [
      goodCell(ARMOUR_GOOD[a.typeId - 1]),
      a.blockingValue,
      a.weight,
      `${precise(stepSeconds(a.weight, state.tribe))} s`,
    ]),
    `Blokada ${BLOCKING_VALUE} jest wliczona w tabelę obrażeń.`,
  );
}

/** One school exercise; a course rounds up to whole exercises. */
const TICKS_PER_SECOND = 12;
const EXERCISE_TICKS = 28;
const courseSeconds = (lessons) =>
  seconds(Math.ceil((lessons * TICKS_PER_SECOND) / EXERCISE_TICKS) * EXERCISE_TICKS);
const FIRST_HERO_JOB = 42;

function jobs() {
  return plainTable(
    ['Zawód', 'Praktyka', 'Szkoła'],
    data.jobs
      .filter((j) => j.requirements.length > 0 && j.typeId < FIRST_HERO_JOB)
      .map((j) => {
        const need = j.requirements.find((r) => r.route === 'need');
        const train = j.requirements.find((r) => r.route === 'train');
        return [
          `<button class="kn-link" data-go="job:${j.id}"><span>${esc(j.name)}</span></button>`,
          need === undefined ? '-' : `${need.amount} × ${esc(need.experience.join(' + '))}`,
          train === undefined ? '-' : `${courseSeconds(train.amount)} s`,
        ];
      }),
  );
}

function homes(state) {
  return plainTable(
    ['Poziom', 'Rodziny', 'Spiżarnia', 'Zdrowie'],
    data.buildings
      .filter((b) => b.kind === 'home')
      .map((b) => [
        `<button class="kn-link" data-go="building:${b.id}"><span>${esc(b.name)}</span></button>`,
        b.homeSize,
        b.stock[0]?.capacity ?? '-',
        number(buildingHitpoints(b, state.tribe)),
      ]),
  );
}

function vehicles() {
  return plainTable(
    ['Pojazd', 'Ładownia', 'Pasażerowie', 'Zdrowie'],
    data.vehicles.map((v) => [
      `<button class="kn-link" data-go="vehicle:${v.id}"><span>${esc(v.name)}</span></button>`,
      v.stockSlots,
      v.passengerSlots,
      number(v.hitpoints),
    ]),
  );
}

function animals() {
  return plainTable(
    ['Zwierzę', 'Zdrowie', 'Atakuje', 'Stado', 'Oswoić', 'Myśliwy sam'],
    data.animals
      .slice()
      .sort((a, b) => b.hitpoints - a.hitpoints)
      .map((a) => [
        `<button class="kn-link" data-go="animal:${a.tribe}"><span>${esc(a.name)}</span></button>`,
        number(a.hitpoints),
        a.aggressive ? 'sam' : a.getAngry ? 'gdy zaatakowane' : 'nie',
        a.groupSize,
        a.catchable ? 'tak' : 'nie',
        a.huntable ? 'tak' : 'nie',
      ]),
  );
}

const EXPERIENCE_POINTS = [1, 2, 3, 4, 5, 10, 25, 50, 100, 162];
function experiencePercent(points) {
  const inverse = Math.trunc(10000 / (20 * points + 100));
  return Math.min(100, Math.trunc((10000 - 100 * inverse) / 98));
}

function experience() {
  return plainTable(
    ['Punkty', 'Doświadczenie', 'Oszczędzone ciosy', 'Dodatkowa produkcja'],
    EXPERIENCE_POINTS.map((p) => {
      const pct = experiencePercent(p);
      return [p, `${pct}%`, Math.trunc(pct / 20), `+${number(Math.trunc((pct * 15) / 100) / 10)} sztuki`];
    }),
  );
}

export const DATA_BLOCKS = { matrix, armour, jobs, homes, vehicles, animals, experience };
