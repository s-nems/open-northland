import {
  buildingByType,
  buildingLink,
  buildingStatus,
  buildingThumb,
  DEMO,
  data,
  depthOf,
  downstreamOf,
  edges,
  esc,
  goodById,
  goodByType,
  goodIcon,
  goodLink,
  jobByType,
  jobLink,
  LANES,
  producersOf,
  rawCost,
  recipesOf,
  seconds,
  upstreamOf,
  usesOf,
} from './model.js';

const NODE_W = 148;
const NODE_H = 32;
const COL_W = 178;
const ROW_H = 38;
const LANE_PAD = 10;
const STAGES = ['Surowce', 'Etap 1', 'Etap 2', 'Etap 3', 'Etap 4'];

function layout(visible) {
  const nodes = [];
  let top = 0;
  const lanes = [];
  for (const lane of LANES) {
    const goods = data.goods.filter((g) => g.lane === lane.id && (visible === null || visible.has(g.typeId)));
    if (goods.length === 0) continue;
    const columns = new Map();
    for (const good of goods) {
      const column = depthOf(good.typeId);
      if (!columns.has(column)) columns.set(column, []);
      columns.get(column).push(good);
    }
    const rows = Math.max(...[...columns.values()].map((c) => c.length));
    for (const [column, list] of columns) {
      list.forEach((good, row) => {
        nodes.push({ good, x: column * COL_W + 10, y: top + LANE_PAD + row * ROW_H });
      });
    }
    const height = rows * ROW_H + LANE_PAD * 2 - (ROW_H - NODE_H);
    lanes.push({ ...lane, top, height });
    top += height + 2;
  }
  return { nodes, lanes, height: top, width: STAGES.length * COL_W + 10 };
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(26, (x2 - x1) / 2);
  return `M${x1} ${y1}C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`;
}

function goodsMap(state) {
  const selected = state.entry?.kind === 'good' ? goodById.get(state.entry.id) : null;
  const up = selected === null ? new Set() : upstreamOf(selected.typeId);
  const down = selected === null ? new Set() : downstreamOf(selected.typeId);
  const related = selected === null ? null : new Set([selected.typeId, ...up, ...down]);
  const shown = layout(state.onlyChain && related !== null ? related : null);
  const at = new Map(shown.nodes.map((n) => [n.good.typeId, n]));
  const paths = edges
    .filter((e) => at.has(e.from) && at.has(e.to))
    .map((e) => {
      const lit =
        selected !== null &&
        ((up.has(e.from) && (up.has(e.to) || e.to === selected.typeId)) ||
          (down.has(e.to) && (down.has(e.from) || e.from === selected.typeId)));
      const side =
        selected === null ? '' : up.has(e.from) || e.to === selected.typeId ? ' is-up' : ' is-down';
      return `<path class="kn-edge kn-edge--${e.kind}${lit ? ` is-lit${side}` : ''}${selected !== null && !lit ? ' is-dim' : ''}" d="${edgePath(at.get(e.from), at.get(e.to))}"/>`;
    })
    .join('');
  const nodes = shown.nodes
    .map(({ good, x, y }) => {
      const role =
        selected === null
          ? ''
          : good === selected
            ? ' is-selected'
            : up.has(good.typeId)
              ? ' is-up'
              : down.has(good.typeId)
                ? ' is-down'
                : ' is-dim';
      return `<button class="kn-node${role}" style="left:${x}px;top:${y}px" data-pick="good:${good.id}">${goodIcon(good)}<span>${esc(good.name)}</span></button>`;
    })
    .join('');
  const lanes = shown.lanes
    .map(
      (l) =>
        `<div class="kn-lane" data-lane-at="${l.id}" style="top:${l.top}px;height:${l.height}px"><span>${esc(l.name)}</span></div>`,
    )
    .join('');
  const heads = STAGES.map((name) => `<span style="width:${COL_W}px">${name}</span>`).join('');
  const scale = state.zoom;
  return `<div class="kn-map" data-keep-scroll="map">
    <div class="kn-stages" style="zoom:${scale}"><i></i>${heads}</div>
    <div class="kn-mapbody" style="zoom:${scale};height:${shown.height}px;width:${shown.width + 96}px">
      ${lanes}
      <div class="kn-mapplane" style="height:${shown.height}px;width:${shown.width}px">
        <svg width="${shown.width}" height="${shown.height}">${paths}</svg>
        ${nodes}
      </div>
    </div>
  </div>`;
}

function recipeLine(input) {
  return `<span class="kn-recipe__part">${goodLink(goodByType.get(input.goodType), input.amount)}</span>`;
}

function howToGet(good) {
  const parts = [];
  for (const { building, recipe } of (recipesOf.get(good.typeId) ?? []).slice(0, 1)) {
    parts.push(`<div class="kn-recipe">${recipe.inputs.map(recipeLine).join('<i>+</i>')}</div>
      <p class="kn-side__note">${buildingLink(building)} · ${seconds(recipe.ticks)} s na cykl</p>`);
  }
  for (const building of producersOf(good))
    parts.push(`<p class="kn-side__note">${buildingLink(building)}</p>`);
  const workers = (data.gatheredBy[good.typeId] ?? []).map((w) => jobByType.get(w.job)).filter(Boolean);
  if (workers.length > 0 && !recipesOf.has(good.typeId)) {
    parts.push(`<p class="kn-side__note">Pozyskuje: ${workers.map(jobLink).join(', ')}</p>`);
  }
  if (good.edibleForm !== null) {
    parts.push(
      `<p class="kn-side__note">Poza budynkiem działa jak ${goodLink(goodById.get(good.edibleForm))}</p>`,
    );
  }
  return parts.join('') || '<p class="kn-side__note">Nie ma źródła w danych tej gry.</p>';
}

function usedFor(good) {
  const outputs = new Map();
  for (const { recipe } of usesOf.get(good.typeId) ?? []) {
    for (const output of recipe.outputs) outputs.set(output.goodType, goodByType.get(output.goodType));
  }
  const links = [...outputs.values()]
    .slice(0, 10)
    .map((g) => goodLink(g))
    .join('');
  if (links !== '') return `<div class="kn-links">${links}</div>`;
  if (good.equip !== null) return '<p class="kn-side__note">Osadnik nosi to przy sobie.</p>';
  if (good.edibleForm !== null) return '<p class="kn-side__note">Jedzenie.</p>';
  return '<p class="kn-side__note">Nie jest składnikiem żadnej receptury.</p>';
}

function unlockLine(good) {
  const rows = data.goodRequirements[good.typeId];
  if (rows === undefined) return '';
  return rows
    .filter((r) => r.route === 'need')
    .map((r) => `<p class="kn-side__note">Odkrycie: ${r.amount} × ${r.experience.map(esc).join(' + ')}</p>`)
    .join('');
}

function goodSide(good, state) {
  const raw = [...rawCost(good.typeId)];
  const rawLine =
    raw.length > 1 || (raw[0] !== undefined && raw[0][0] !== good.typeId)
      ? `<h4>Koszt w surowcach</h4><div class="kn-links">${raw.map(([type, amount]) => goodLink(goodByType.get(type), amount)).join('')}</div>`
      : '';
  const stock =
    state.mode === 'game' && DEMO.stock[good.name] !== undefined
      ? `<p class="kn-live">W magazynach: <b>${DEMO.stock[good.name]}</b></p>`
      : '';
  return `<header class="kn-side__head">${goodIcon(good)}<div><h3>${esc(good.name)}</h3><small>${esc(LANES.find((l) => l.id === good.lane)?.name ?? '')}</small></div></header>
    ${stock}
    <h4>Jak zdobyć</h4>${howToGet(good)}${unlockLine(good)}
    ${rawLine}
    <h4>Do czego służy</h4>${usedFor(good)}
    ${good.equip === null ? '' : `<h4>Na wyposażeniu</h4><p class="kn-side__note">${esc(good.equip.effect)} · ${esc(good.equip.wears)}</p>`}
    <div class="kn-side__actions">
      <button class="on-button on-button--rounded" data-open="good:${good.id}">Otwórz hasło</button>
      <button class="on-button on-button--rounded" data-toggle="onlyChain" aria-pressed="${state.onlyChain}">${state.onlyChain ? 'Pokaż całość' : 'Tylko ten łańcuch'}</button>
    </div>`;
}

function emptySide() {
  return `<div class="kn-side__empty"><h3>Wybierz towar</h3><p>Wskaż dowolny towar, a drzewo pokaże skąd pochodzi i do czego idzie. Szukanie u góry też tu trafia.</p>
    <ul class="kn-legend">
      <li><i class="kn-swatch is-up"></i> z czego powstaje</li>
      <li><i class="kn-swatch is-down"></i> co z niego powstaje</li>
      <li><i class="kn-swatch is-meal"></i> staje się posiłkiem</li>
    </ul></div>`;
}

const TIER_ROOT = (building) => !data.buildings.some((b) => b.upgradeTarget === building.typeId);

function tierChain(start) {
  const chain = [start];
  for (let next = start.upgradeTarget; next != null; next = buildingByType.get(next)?.upgradeTarget) {
    const building = buildingByType.get(next);
    if (building === undefined) break;
    chain.push(building);
  }
  return chain;
}

const KIND_GROUPS = [
  { id: 'home', name: 'Mieszkania' },
  { id: 'storage', name: 'Magazyny' },
  { id: 'workplace', name: 'Warsztaty' },
  { id: 'training', name: 'Nauka' },
  { id: 'tower', name: 'Obrona' },
];

function buildingCard(building, state) {
  const status = state.mode === 'game' ? buildingStatus(building) : { kind: 'ok', text: '' };
  const selected = state.entry?.kind === 'building' && state.entry.id === building.id;
  return `<button class="kn-tier kn-tier--${status.kind}${selected ? ' is-selected' : ''}" data-pick="building:${building.id}">
    ${buildingThumb(building)}<b>${esc(building.name)}</b>${status.kind === 'ok' ? '' : `<small>${status.kind === 'map' ? 'poza mapą' : 'zablokowany'}</small>`}
  </button>`;
}

function buildingsMap(state) {
  return `<div class="kn-tiers" data-keep-scroll="tiers">${KIND_GROUPS.map((group) => {
    const roots = data.buildings.filter((b) => b.kind === group.id && TIER_ROOT(b));
    const rows = roots
      .sort((a, b) => tierChain(b).length - tierChain(a).length)
      .map((root) => tierChain(root))
      .map(
        (chain) =>
          `<div class="kn-tierrow">${chain.map((b) => buildingCard(b, state)).join('<i class="kn-arrow"></i>')}</div>`,
      )
      .join('');
    return `<section><h3 class="on-section">${esc(group.name)}</h3>${rows}</section>`;
  }).join('')}</div>`;
}

function buildingSide(building, state) {
  const status = state.mode === 'game' ? buildingStatus(building) : null;
  const cost = building.cost.map((c) => goodLink(goodByType.get(c.good), c.amount)).join('');
  const made = [...new Set(building.recipes.flatMap((r) => r.outputs.map((o) => o.goodType)))];
  const next = building.upgradeTarget == null ? null : buildingByType.get(building.upgradeTarget);
  return `<header class="kn-side__head">${buildingThumb(building)}<div><h3>${esc(building.name)}</h3></div></header>
    ${status === null ? '' : `<p class="kn-chip kn-chip--${status.kind}">${esc(status.text)}</p>`}
    <h4>Koszt budowy</h4><div class="kn-links">${cost || '<span class="kn-side__note">Nie buduje się</span>'}</div>
    ${
      made.length === 0
        ? ''
        : `<h4>Wytwarza</h4><div class="kn-links">${made
            .slice(0, 10)
            .map((t) => goodLink(goodByType.get(t)))
            .join('')}</div>`
    }
    ${next === undefined || next === null ? '' : `<h4>Rozbudowa</h4><p class="kn-side__note">${buildingLink(next)}</p>`}
    <div class="kn-side__actions"><button class="on-button on-button--rounded" data-open="building:${building.id}">Otwórz hasło</button></div>`;
}

/** Trades with no prior trade start the rows; each later trade sits after the trade whose track unlocks it. */
function jobsMap(state) {
  const JOB_ROOTS = ['collector', 'farmer', 'hunter', 'carrier', 'fisher', 'builder', 'scout'];
  const childrenOf = (typeId) =>
    data.jobs.filter(
      (j) => j.requirements.some((r) => r.route === 'need' && r.fromJobs.includes(typeId)) && j.typeId < 31,
    );
  const cell = (job) => {
    const need = job.requirements.find((r) => r.route === 'need');
    const selected = state.entry?.kind === 'job' && state.entry.id === job.id;
    return `<button class="kn-job${selected ? ' is-selected' : ''}" data-pick="job:${job.id}"><b>${esc(job.name)}</b>${need === undefined ? '' : `<small>${need.amount} × ${esc(need.experience.join(' + '))}</small>`}</button>`;
  };
  const branch = (job) => {
    const kids = childrenOf(job.typeId);
    return `<div class="kn-branch">${cell(job)}${kids.length === 0 ? '' : `<div class="kn-branch__kids">${kids.map(branch).join('')}</div>`}</div>`;
  };
  const soldiers = ['soldier_unarmed', 'soldier_spear_wooden', 'soldier_sword_short', 'soldier_bow_short'];
  const upgrades = {
    soldier_spear_wooden: 'soldier_spear_iron',
    soldier_sword_short: 'soldier_sword_long',
    soldier_bow_short: 'soldier_bow_long',
  };
  const byId = (id) => data.jobs.find((j) => j.id === id);
  const soldierTree = soldiers
    .slice(1)
    .map(
      (id) =>
        `<div class="kn-branch">${cell(byId(id))}<div class="kn-branch__kids"><div class="kn-branch">${cell(byId(upgrades[id]))}</div></div></div>`,
    )
    .join('');
  return `<div class="kn-jobs" data-keep-scroll="jobs">
    <h3 class="on-section">Cywile</h3>
    ${JOB_ROOTS.map((id) => byId(id))
      .filter(Boolean)
      .map(branch)
      .join('')}
    <h3 class="on-section">Żołnierze</h3>
    <div class="kn-branch">${cell(byId('soldier_unarmed'))}<div class="kn-branch__kids">${soldierTree}</div></div>
  </div>`;
}

function jobSide(job) {
  const need = job.requirements.filter((r) => r.route === 'need');
  const train = job.requirements.filter((r) => r.route === 'train');
  const enablesGoods = (job.enables.good ?? [])
    .slice(0, 10)
    .map((g) => goodLink(goodByType.get(g.id)))
    .join('');
  return `<header class="kn-side__head"><div><h3>${esc(job.name)}</h3></div></header>
    <h4>Jak się nauczyć</h4>
    ${need.length === 0 ? '<p class="kn-side__note">Dostępny od początku.</p>' : need.map((r) => `<p class="kn-side__note">Praktyka: ${r.amount} × ${esc(r.experience.join(' + '))}</p>`).join('')}
    ${train.map((r) => `<p class="kn-side__note">Po odkryciu także szkoła: ${r.amount} s nauki</p>`).join('')}
    ${enablesGoods === '' ? '' : `<h4>Wytwarza</h4><div class="kn-links">${enablesGoods}</div>`}
    <div class="kn-side__actions"><button class="on-button on-button--rounded" data-open="job:${job.id}">Otwórz hasło</button></div>`;
}

const LENSES = [
  { id: 'goods', name: 'Towary' },
  { id: 'buildings', name: 'Budynki' },
  { id: 'jobs', name: 'Zawody' },
];

export function productionView(state) {
  const lens = `<div class="on-segmented kn-lens">${LENSES.map(
    (l) => `<button aria-pressed="${state.lens === l.id}" data-lens="${l.id}">${l.name}</button>`,
  ).join('')}</div>`;
  const zoom =
    state.lens === 'goods'
      ? `<div class="on-segmented kn-lens">${[
          [0.75, '75%'],
          [1, '100%'],
        ]
          .map(([v, t]) => `<button aria-pressed="${state.zoom === v}" data-zoom="${v}">${t}</button>`)
          .join('')}</div>`
      : '';
  const sectionJump =
    state.lens === 'goods'
      ? `<div class="kn-jumps">${LANES.map((l) => `<button data-lane="${l.id}">${l.name}</button>`).join('')}</div>`
      : state.lens === 'buildings'
        ? `<span class="kn-hint">Strzałka to rozbudowa na miejscu</span>`
        : `<span class="kn-hint">Zawód otwiera praca na poprzednim albo szkoła</span>`;
  const main =
    state.lens === 'goods'
      ? goodsMap(state)
      : state.lens === 'buildings'
        ? buildingsMap(state)
        : jobsMap(state);
  let side = emptySide();
  if (state.entry?.kind === 'good' && goodById.has(state.entry.id))
    side = goodSide(goodById.get(state.entry.id), state);
  if (state.entry?.kind === 'building')
    side = buildingSide(
      data.buildings.find((b) => b.id === state.entry.id),
      state,
    );
  if (state.entry?.kind === 'job') side = jobSide(data.jobs.find((j) => j.id === state.entry.id));
  return `<div class="kn-prod">
    <div class="kn-prod__bar">${lens}${zoom}${sectionJump}</div>
    <div class="kn-prod__main">${main}</div>
    <aside class="kn-side">${side}</aside>
  </div>`;
}
