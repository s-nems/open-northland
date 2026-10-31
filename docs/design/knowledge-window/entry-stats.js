// The stat sheets beside a weapon, an armour, a vehicle and an animal. Each table reads the same combat
// maths as the Mechaniki calculator, so the two cannot disagree.
import {
  ANIMAL_TARGET,
  BLOCKING_VALUE,
  CAP_HITS,
  cadenceText,
  hitsToKill,
  isRanged,
  landed,
  NO_MODIFIERS,
  perSecond,
  perSecondText,
  secondsForHits,
  stepSeconds,
  TARGETS,
} from './combat.js';
import {
  animalPicture,
  buildingById,
  buildingLink,
  data,
  esc,
  goodById,
  goodByType,
  goodIcon,
  goodLink,
  jobLink,
  number,
  precise,
  STRIPS,
  seconds,
} from './model.js';

const MELEE_NAME = {
  1: 'Bez broni',
  2: 'Wręcz',
  3: 'Wręcz',
  4: 'Wręcz',
  5: 'Wręcz',
  6: 'Dystans',
  7: 'Dystans',
};

const soldierRow = (w) => !w.id.startsWith('hero_');
export const weaponOf = (good, tribe) =>
  data.weapons[tribe].find((w) => w.goodType === good.typeId && w.usable && soldierRow(w)) ??
  data.weapons[tribe].find((w) => w.goodType === good.typeId);
export const armourOf = (good) => data.armor.find((a) => a.goodType === good.typeId);

/** A tribe's craftable weapons, once each: heroes carry the same goods with rows of their own. */
const shownWeapons = (tribe) =>
  data.weapons[tribe].filter((w) => w.usable && w.goodType !== null && !w.id.startsWith('hero_'));

/** A weapon's name in a table; the catapult's row names its stone as the good. */
const weaponLabel = (weapon) => {
  if (weapon.id === 'catapult')
    return '<button class="kn-link" data-go="vehicle:catapult"><span>Katapulta</span></button>';
  return weapon.goodType === null
    ? esc(weapon.jobName ?? weapon.id)
    : goodLink(goodByType.get(weapon.goodType));
};

function heatTable(head, rows, heatColumn) {
  const peak = Math.max(1, ...rows.map((r) => r.heat));
  return `<table class="kn-table"><thead><tr>${head
    .map((h, i) => `<th class="${i === 0 ? '' : 'kn-num'}">${h}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><th scope="row">${r.label}</th>${r.cells
          .map(
            (c, i) =>
              `<td class="kn-num${i === heatColumn ? ' kn-heat' : ''}"${i === heatColumn ? ` style="--heat:${(r.heat / peak).toFixed(2)}"` : ''}>${c}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}

function targetLabel(target) {
  if (target.good === undefined) return esc(target.name);
  const good = goodById.get(target.good);
  return `<button class="kn-link" data-go="good:${good.id}">${goodIcon(good)}<span>${esc(target.name)}</span></button>`;
}

function damageTable(weapon) {
  const rows = TARGETS.map((target) => {
    const damage = landed(weapon, target);
    const hits = target.person ? hitsToKill(damage) : null;
    return {
      label: targetLabel(target),
      heat: damage,
      cells: [number(damage), hits ?? '-', perSecondText(damage, weapon)],
    };
  });
  return heatTable(['Przeciw', 'Obrażenia', 'Ciosy do śmierci', 'Na sekundę'], rows, 0);
}

function bonusTable(weapon) {
  const plain = TARGETS[0];
  const row = (label, change, note) => [
    label,
    note,
    number(landed(weapon, plain, { ...NO_MODIFIERS, ...change })),
  ];
  const rows = [
    row('Cios od przodu', {}, '×1'),
    row('Cios z boku od tyłu', { direction: 125 }, '×1,25'),
    row('Cios od tyłu', { direction: 150 }, '×1,5'),
    row('Amulet Siły', { strength: true }, '×1,5'),
    ...(isRanged(weapon) ? [] : [row(`${CAP_HITS} trafień tą klasą broni`, { hits: CAP_HITS }, '×2')]),
  ];
  const crit = landed(weapon, plain) * 2;
  return `<table class="kn-table"><thead><tr><th>Bonus</th><th class="kn-num">Mnożnik</th><th class="kn-num">Bez pancerza</th></tr></thead><tbody>${rows
    .map(
      ([a, b, c]) =>
        `<tr><th scope="row">${a}</th><td class="kn-num">${b}</td><td class="kn-num">${c}</td></tr>`,
    )
    .join(
      '',
    )}<tr><th scope="row">Amulet Precyzji</th><td class="kn-num">20% szans na ×2</td><td class="kn-num">${number(crit)}</td></tr></tbody></table>`;
}

function marchTable(weight, tribe) {
  const plainStep = stepSeconds(0, tribe);
  const rows = [
    { name: 'Bez pancerza', weight: 0 },
    ...data.armor.map((a) => ({ name: a.name, weight: a.weight })),
  ];
  return `<table class="kn-table"><thead><tr><th>Z pancerzem</th><th class="kn-num">Krok</th><th class="kn-num">Wolniej</th></tr></thead><tbody>${rows
    .map((row) => {
      const step = stepSeconds(weight + row.weight, tribe);
      const slower = Math.round((step / plainStep - 1) * 100);
      return `<tr><th scope="row">${esc(row.name)}</th><td class="kn-num">${precise(step)} s</td><td class="kn-num">${slower === 0 ? '-' : `${slower}%`}</td></tr>`;
    })
    .join('')}</tbody></table><p class="kn-foot">W butach, na lądzie. Bohaterów ciężar nie spowalnia.</p>`;
}

/** A filmed cycle runs at the sim's 12 frames a second; */
const FRAME_SECONDS = 1 / 12;
const CLIP_SCALE = { soldier: 1.6, animal: 1.6 };

function strip(key, scaleOf) {
  const clip = STRIPS[key];
  if (clip === undefined) return '<span class="kn-strip kn-strip--none">Brak nagrania</span>';
  const width = clip.width * scaleOf;
  const height = clip.height * scaleOf;
  return `<span class="kn-strip" style="--w:${width}px;--h:${height}px;--n:${clip.frames};--t:${(clip.frames * FRAME_SECONDS).toFixed(2)}s;background-image:url('/review/anims/${key}.png')"></span>`;
}

/** The moving pictures beside a stat sheet: the window plays the unit's own sprite here. */
export function motionPreview(clips, kind) {
  return `<figure class="kn-motion">${clips
    .map(
      ({ key, name, text }) =>
        `<div class="kn-motion__clip">${strip(key, CLIP_SCALE[kind])}<figcaption><b>${esc(name)}</b>${esc(text)}</figcaption></div>`,
    )
    .join('')}</figure>`;
}

/** Which filmed soldier carries a weapon. */
const WEAPON_FILM = {
  spear_wooden: 'spear',
  spear_iron: 'spear',
  sword_shord: 'sword',
  sword_long: 'broadsword',
  bow_short: 'shortbow',
  bow_long: 'longbow',
};

/** A weapon is opened by its maker's experience; the soldier who picks it up needs no more than the good. */
function requirement(good, weapon) {
  const job = data.jobs.find((j) => j.typeId === weapon.job);
  const discovery = data.goodRequirements[good.typeId]?.find((r) => r.route === 'need');
  return `${job === undefined ? '' : `<dt>Nosi</dt><dd>${jobLink(job)}</dd>`}${discovery === undefined ? '' : `<dt>Odkrycie</dt><dd>${discovery.amount} × ${esc(discovery.experience.join(' + '))}</dd>`}`;
}

export function weaponSheet(good, tribe) {
  const weapon = weaponOf(good, tribe);
  if (weapon === undefined) return '<p class="kn-empty">To plemię nie używa tej broni.</p>';
  const range =
    weapon.minRange === weapon.maxRange ? weapon.maxRange : `${weapon.minRange}-${weapon.maxRange}`;
  const left = `<h3 class="kn-h">Obrażenia</h3>${damageTable(weapon)}
    <p class="kn-foot">Człowiek ma 5000 zdrowia. Pancerz odejmuje jeszcze ${BLOCKING_VALUE} od ciosu, wliczone. Amulet Obrony celu dzieli wynik przez 2.</p>
    <h3 class="kn-h">Bonusy</h3>${bonusTable(weapon)}`;
  const film = WEAPON_FILM[good.id];
  const right = `${motionPreview(
    [
      {
        key: `${film}-attack`,
        name: 'Cios',
        text: cadenceText(weapon),
      },
      { key: `${film}-walk`, name: 'Marsz', text: `krok ${precise(stepSeconds(weapon.weight, tribe))} s` },
    ],
    'soldier',
  )}
    <h3 class="kn-h">Dane</h3><dl>
      <dt>Typ</dt><dd>${MELEE_NAME[weapon.mainType] ?? '-'}</dd>
      <dt>Zasięg</dt><dd>${range}</dd>
      <dt>Cios co</dt><dd>${cadenceText(weapon)}</dd>
      <dt>Ciężar</dt><dd>${weapon.weight}</dd>
      ${requirement(good, weapon)}
    </dl>
    <h3 class="kn-h">Szybkość marszu</h3>${marchTable(weapon.weight, tribe)}`;
  return { left, right };
}

export function armourSheet(good, tribe) {
  const armour = armourOf(good);
  const target = TARGETS.find((t) => t.good === good.id);
  const rows = shownWeapons(tribe).map((weapon) => {
    const damage = landed(weapon, target);
    const bare = landed(weapon, TARGETS[0]);
    return {
      label: weaponLabel(weapon),
      heat: perSecond(damage, weapon) ?? 0,
      cells: [
        number(damage),
        hitsToKill(damage) ?? '-',
        perSecondText(damage, weapon),
        bare === 0 ? '-' : `${Math.round((1 - damage / bare) * 100)}%`,
      ],
    };
  });
  const left = `<h3 class="kn-h">Co robi z nim każda broń</h3>${heatTable(['Broń', 'Obrażenia', 'Ciosy do śmierci', 'Na sekundę', 'Zatrzymuje'], rows, 2)}
    <p class="kn-foot">Bez bonusów. Zatrzymuje to ile mniej wchodzi niż bez pancerza. Kolorem obrażenia na sekundę.</p>`;
  const right = `<h3 class="kn-h">Dane</h3><dl>
      <dt>Blokada</dt><dd>${armour.blockingValue}</dd>
      <dt>Ciężar</dt><dd>${armour.weight}</dd>
      <dt>Zużycie</dt><dd>nie zużywa się</dd>
    </dl>
    <h3 class="kn-h">Szybkość marszu</h3>
    <table class="kn-table"><tbody><tr><th scope="row">Sam pancerz</th><td class="kn-num">${precise(stepSeconds(armour.weight, tribe))} s</td></tr></tbody></table>
    <p class="kn-foot">Ciężar sumuje się z bronią. Krok w butach na lądzie bez niczego: ${precise(stepSeconds(0, tribe))} s.</p>`;
  return { left, right };
}

export function vehicleEntryHtml(vehicle) {
  const building = buildingById.get(vehicle.id);
  const good = goodById.get(vehicle.id);
  const cost = (building?.cost ?? []).map((c) => goodLink(goodByType.get(c.good), c.amount)).join('');
  return `<article class="kn-entry">
    <header class="kn-entry__head">${goodIcon(good)}<div><h2>${esc(vehicle.name)}</h2><p>Pojazd</p></div></header>
    <div class="kn-entry__cols"><div>
      <h3 class="kn-h">Budowa</h3><div class="kn-links">${cost}</div>
      ${building === undefined ? '' : `<p>Plac budowy: ${buildingLink(building)}</p>`}
      <p class="kn-seealso"><button class="kn-link" data-article="vehicles"><span>Mechanika: pojazdy i statki</span></button></p>
    </div><aside class="kn-facts">
      <h3 class="kn-h">Dane</h3><dl>
        <dt>Ładownia</dt><dd>${vehicle.stockSlots}</dd>
        <dt>Pasażerowie</dt><dd>${vehicle.passengerSlots}</dd>
        <dt>Zdrowie</dt><dd>${number(vehicle.hitpoints)}</dd>
      </dl>
    </aside></div></article>`;
}

/** What sets a people apart: its weapon rows and its step. */
export function tribeEntryHtml(tribe) {
  const plate = TARGETS[4];
  const rows = shownWeapons(tribe.typeId).map((weapon) => {
    const bare = landed(weapon, TARGETS[0]);
    return {
      label: weaponLabel(weapon),
      heat: bare,
      cells: [number(bare), number(landed(weapon, plate)), cadenceText(weapon), perSecondText(bare, weapon)],
    };
  });
  const heroes = data.weapons[tribe.typeId].filter((w) => w.usable && w.id.startsWith('hero_'));
  return `<article class="kn-entry">
    <header class="kn-entry__head"><div><h2>${esc(tribe.name)}</h2><p>Plemię</p></div></header>
    <div class="kn-entry__cols"><div>
      <h3 class="kn-h">Broń</h3>${heatTable(['Broń', 'Bez pancerza', 'Płytowa', 'Cios co', 'Na sekundę'], rows, 0)}
      <p class="kn-foot">Zmień plemię w pasku, żeby zobaczyć hasła broni tego plemienia.</p>
    </div><aside class="kn-facts">
      <h3 class="kn-h">Dane</h3><dl>
        <dt>Krok w butach</dt><dd>${precise(stepSeconds(0, tribe.typeId))} s</dd>
      </dl>
      <h3 class="kn-h">Bohaterowie</h3>
      <div class="kn-links">${heroes.map((h) => `<span>${esc(h.jobName ?? h.id)}</span>`).join('')}</div>
      <p class="kn-seealso"><button class="kn-link" data-article="heroes"><span>Mechanika: bohaterowie</span></button></p>
    </aside></div></article>`;
}

/** Seconds per step off an animal's `moveSpeed`, the ticks one step takes. */
const speedText = (ticks) => (ticks === 0 ? '-' : `${seconds(ticks)} s`);

function huntTable(animal, tribe) {
  const rows = shownWeapons(tribe)
    .concat(data.weapons[tribe].filter((w) => w.id === 'hunter_bow'))
    .map((weapon) => {
      const damage = landed(weapon, ANIMAL_TARGET);
      const hits = hitsToKill(damage, animal.hitpoints);
      const time = hits === null ? null : secondsForHits(hits, weapon);
      return {
        label: weaponLabel(weapon),
        heat: perSecond(damage, weapon) ?? 0,
        cells: [number(damage), hits ?? '-', time === null ? '-' : `${number(time)} s`],
      };
    });
  return heatTable(['Broń', 'Obrażenia', 'Ciosy', 'Czas zabicia'], rows, 0);
}

export function animalEntryHtml(animal, tribe) {
  const temper = animal.aggressive ? 'atakuje sam' : animal.getAngry ? 'gdy zaatakowane' : 'nie atakuje';
  const attack =
    animal.weapon === null
      ? ''
      : `<h3 class="kn-h">Jego atak</h3>${heatTable(
          ['Przeciw', 'Obrażenia', 'Ciosy do śmierci'],
          TARGETS.filter((t) => t.person).map((target) => {
            const damage = landed({ id: 'animal', mainType: null, damage: animal.weapon.damage }, target);
            return {
              label: esc(target.name),
              heat: damage,
              cells: [number(damage), hitsToKill(damage) ?? '-'],
            };
          }),
          0,
        )}`;
  return `<article class="kn-entry">
    <header class="kn-entry__head">${animalPicture(animal)}<div><h2>${esc(animal.name)}</h2><p>Zwierzę</p></div></header>
    <div class="kn-entry__cols"><div>
      ${attack}
      <h3 class="kn-h">Ile trzeba, żeby je zabić</h3>${huntTable(animal, tribe)}
      <p class="kn-foot">Zwierzę liczy się jak skórzana zbroja, bez blokady.</p>
    </div><aside class="kn-facts">
      ${motionPreview(
        [
          { key: `animal-${animal.tribe}-walk`, name: 'Chód', text: `krok ${speedText(animal.moveSpeed)}` },
          ...(animal.weapon === null
            ? []
            : [{ key: `animal-${animal.tribe}-attack`, name: 'Atak', text: 'wręcz' }]),
        ],
        'animal',
      )}
      <h3 class="kn-h">Dane</h3><dl>
        <dt>Zdrowie</dt><dd>${number(animal.hitpoints)}</dd>
        <dt>Młode</dt><dd>${number(animal.hitpointsYoung)}</dd>
        <dt>Krok</dt><dd>${speedText(animal.moveSpeed)}</dd>
        <dt>Bieg</dt><dd>${speedText(animal.runSpeed)}</dd>
        <dt>Temperament</dt><dd>${temper}</dd>
        <dt>Stado do</dt><dd>${animal.groupSize}</dd>
        <dt>Oswoić</dt><dd>${animal.catchable ? 'tak' : 'nie'}</dd>
        <dt>Myśliwy poluje sam</dt><dd>${animal.huntable ? 'tak' : 'nie, tylko na rozkaz'}</dd>
      </dl>
    </aside></div></article>`;
}
