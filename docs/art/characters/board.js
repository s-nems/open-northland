const facings = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S'];
const labels = { approved: 'Zatwierdzone', review: 'Do oceny', missing: 'Brakuje sprite’ów' };
const controls = Object.fromEntries(
  ['mode', 'facing', 'head', 'ground', 'zoom', 'pause', 'restart', 'phase'].map((id) => [
    id,
    document.getElementById(id),
  ]),
);
const selectedHeads = new Set();
function updateChoice(data) {
  document.getElementById('choice').textContent =
    `Twój wybór (${selectedHeads.size}/${data.selectionTarget}): ` +
    data.heads
      .filter((head) => selectedHeads.has(head.id))
      .map((head) => head.name)
      .join(', ');
}
const backgrounds = new Map();
for (const [id, file] of [
  ['grass', '../terrain/grass/grass-base.png'],
  ['soil', '../terrain/grass/soil.png'],
]) {
  const image = new Image();
  image.src = file;
  backgrounds.set(id, image);
}
let cells = [],
  elapsed = 0,
  previous = 0,
  playing = true,
  scrub = null;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function show(data) {
  cells = [];
  const compare = controls.mode.value === 'heads';
  controls.head.disabled = compare;
  controls.facing.disabled = !compare;
  const columns = compare
    ? data.heads
        .filter((h) => data.actions.some((a) => Object.keys(a.variants[h.id] ?? {}).length > 0))
        .map((h) => ({ name: h.name, head: h.id, facing: controls.facing.value }))
    : facings.map((f) => ({ name: f, head: controls.head.value, facing: f }));
  const header = element('tr');
  header.append(element('th', 'Animacja'));
  for (const col of columns) {
    const heading = element('th', col.name);
    if (compare) {
      const approved = data.approvedHeads.includes(col.head);
      const label = element('label', approved ? 'Zatwierdzony' : 'Wybieram');
      const input = element('input');
      input.type = 'checkbox';
      input.checked = selectedHeads.has(col.head);
      input.disabled = approved;
      input.onchange = () => {
        if (input.checked && selectedHeads.size >= data.selectionTarget) {
          input.checked = false;
          return;
        }
        if (input.checked) selectedHeads.add(col.head);
        else selectedHeads.delete(col.head);
        updateChoice(data);
      };
      label.prepend(input);
      heading.append(label);
    }
    header.append(heading);
  }
  document.getElementById('columns').replaceChildren(header);
  const body = document.getElementById('animations');
  body.replaceChildren();
  let ready = 0,
    approved = 0;
  for (const action of data.actions) {
    const row = element('tr');
    const heading = element('th', action.name);
    heading.append(element('div', action.description, 'detail'));
    row.append(heading);
    for (const col of columns) {
      const cell = action.variants[col.head]?.[col.facing];
      const td = element('td');
      const status = cell?.status ?? 'missing';
      if (cell) {
        ready++;
        if (status === 'approved') approved++;
        const canvas = element('canvas');
        const image = new Image();
        image.src = `${cell.file}?v=${cell.sha256}`;
        image.onerror = () => {
          document.getElementById('error').textContent = `Nie można wczytać: ${cell.file}`;
        };
        td.append(canvas);
        cells.push({ ...cell, canvas, image });
        td.append(element('div', `${cell.frames} kl. · ${cell.duration.toFixed(2)} s`, 'detail'));
      } else td.append(element('div', '—', 'missing'));
      td.append(element('div', labels[status], `badge ${status}`));
      row.append(td);
    }
    body.append(row);
  }
  document.getElementById('summary').textContent =
    `${ready} / ${data.actions.length * columns.length} klipów kierunkowych w tym widoku · ${approved} zatwierdzonych · ${ready - approved} do oceny`;
}
async function start() {
  const response = await fetch('catalog.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Katalog: HTTP ${response.status}`);
  const data = await response.json();
  const query = new URLSearchParams(location.search);
  if (
    data.reviewHeads &&
    !query.has('archive') &&
    (!query.has('head') || data.reviewHeads.includes(query.get('head')))
  ) {
    data.heads = data.reviewHeads.map((id) => data.heads.find((head) => head.id === id)).filter(Boolean);
    for (const action of data.actions)
      action.variants = Object.fromEntries(
        Object.entries(action.variants).filter(([id]) => data.reviewHeads.includes(id)),
      );
    controls.mode.value = 'heads';
  }
  for (const id of data.approvedHeads) selectedHeads.add(id);
  updateChoice(data);
  const allCells = data.actions.flatMap((a) => Object.values(a.variants).flatMap((v) => Object.values(v)));
  document.getElementById('total').textContent =
    `Cały zestaw: ${data.heads.length} wariantów · ${allCells.length} klipów kierunkowych · ${allCells.filter((c) => c.status === 'approved').length} zatwierdzonych`;
  for (const facing of facings) controls.facing.add(new Option(facing, facing));
  for (const head of data.heads) {
    controls.head.add(new Option(head.name, head.id));
    const card = element('article', null, 'head-card');
    card.append(element('h3', head.name));
    if (head.concept) {
      const link = element('a');
      link.href = head.concept;
      const image = element('img');
      image.src = head.concept;
      image.alt = `Projekt: ${head.name}`;
      link.append(image);
      card.append(link);
      card.append(element('p', 'Projekt fryzury. Aktualny kolor skóry sprawdzaj w animacjach powyżej.'));
    }
    card.append(element('p', head.description));
    card.append(element('p', head.stage));
    const complete = ['walk', 'idle'].every((name) =>
      facings.every(
        (facing) => data.actions.find((action) => action.id === name)?.variants[head.id]?.[facing],
      ),
    );
    if (complete) {
      const mapLink = element('a', 'Obejrzyj tę głowę na Magicznym Lesie →');
      const url = new URL('http://127.0.0.1:5173/');
      url.search = new URLSearchParams({
        map: 'magiczny_las',
        assets: 'own',
        ownHead: head.id,
        intro: 'off',
        zoom: '2',
        fullscreen: 'off',
        center: '37,43',
      });
      mapLink.href = url.href;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener';
      card.append(mapLink);
    }
    document.getElementById('heads').append(card);
  }
  if (query.get('view') === 'heads') controls.mode.value = 'heads';
  if (data.heads.some((h) => h.id === query.get('head'))) {
    controls.head.value = query.get('head');
    if (query.get('view') !== 'heads') controls.mode.value = 'directions';
  }
  if (facings.includes(query.get('facing'))) controls.facing.value = query.get('facing');
  controls.head.onchange = () => show(data);
  controls.mode.onchange = () => show(data);
  controls.facing.onchange = () => show(data);
  show(data);
}
controls.pause.onclick = () => {
  if (!playing && scrub !== null) elapsed = scrub * (cells[0]?.duration ?? 1);
  playing = !playing;
  scrub = null;
  controls.pause.textContent = playing ? 'Pauza' : 'Odtwórz';
};
controls.restart.onclick = () => {
  elapsed = 0;
  scrub = null;
  controls.phase.value = 0;
};
controls.phase.oninput = () => {
  playing = false;
  scrub = Number(controls.phase.value) / 1000;
  controls.pause.textContent = 'Odtwórz';
};
function tick(now) {
  if (previous && playing) elapsed += (now - previous) / 1000;
  previous = now;
  const zoom = Number(controls.zoom.value);
  const ground = backgrounds.get(controls.ground.value);
  for (const cell of cells) {
    const width = 64,
      height = 80;
    if (cell.canvas.width !== width * zoom) {
      cell.canvas.width = width * zoom;
      cell.canvas.height = height * zoom;
    }
    const ctx = cell.canvas.getContext('2d');
    ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#747873';
    ctx.fillRect(0, 0, width, height);
    if (ground?.complete && ground.naturalWidth) {
      const pattern = ctx.createPattern(ground, 'repeat');
      pattern.setTransform(new DOMMatrix().scale(128 / ground.naturalWidth));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
    const phase = scrub ?? (elapsed % cell.duration) / cell.duration;
    let frame = Math.min(cell.frames - 1, Math.floor(phase * cell.frames));
    if (cell.frameDurations) {
      let time = Math.min(phase * cell.duration, cell.duration - 1e-9);
      frame = 0;
      while (frame < cell.frames - 1 && time >= cell.frameDurations[frame]) {
        time -= cell.frameDurations[frame++];
      }
    }
    if (cell.image.complete && cell.image.naturalWidth)
      ctx.drawImage(cell.image, frame * 192, 0, 192, 144, -16, 0, 96, 72);
  }
  requestAnimationFrame(tick);
}
start().catch((error) => {
  document.getElementById('error').textContent = error.message;
});
requestAnimationFrame(tick);
