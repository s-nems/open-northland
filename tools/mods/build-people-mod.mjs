#!/usr/bin/env node
/** Assemble a new-people content pack from the installed `content/` tree (`docs/MODS.md`).
 *
 * The pack clones one civilization's rules (weapons, personal names, attack alerts) onto a free tribe
 * id, and another civilization's house art (the `[GfxHouse]` joins) onto the same id, so the people
 * plays as the first tribe's settlers and builds in the second tribe's style. The result is a partial
 * `ir.json` patch in a ZIP, ready to import on the game's Mods screen.
 *
 * Usage:
 *   node tools/mods/build-people-mod.mjs --id northmen [--from viking] [--buildings frank]
 *        [--name Northmen] [--out northmen.zip] [--content-dir content] [--type-id 42]
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse `--key value` / `--key=value` pairs; anything else is a usage error. */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const [key, inline] = token.slice(2).split('=');
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${key}`);
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const fromId = args.from ?? 'viking';
const buildingsId = args.buildings ?? fromId;
const peopleId = args.id;
if (peopleId === undefined || !/^[a-z][a-z0-9_]*$/.test(peopleId)) {
  console.error(
    'Usage: node tools/mods/build-people-mod.mjs --id <slug> [--from <tribe>] [--buildings <tribe>]' +
      ' [--name <Name>] [--out <file.zip>] [--content-dir <dir>] [--type-id <n>]',
  );
  process.exit(1);
}
const peopleName = args.name ?? peopleId.charAt(0).toUpperCase() + peopleId.slice(1);
const contentDir = resolve(REPO_ROOT, args['content-dir'] ?? 'content');
const outPath = resolve(process.cwd(), args.out ?? `${peopleId}.zip`);

const ir = JSON.parse(readFileSync(resolve(contentDir, 'ir.json'), 'utf8'));

/** The tribes lane holds the five civilizations, the two monsters and the animal species; a weapon or
 *  an animal row binds its own tribe id the same way, so a free id clears every one of them. */
function usedTribeIds() {
  const used = new Set();
  for (const row of ir.tribes ?? []) used.add(row.typeId);
  for (const row of ir.animals ?? []) used.add(row.tribeType);
  for (const row of ir.weapons ?? []) if (row.tribeType !== undefined) used.add(row.tribeType);
  return used;
}

function tribeIdBySlug(slug) {
  const row = (ir.tribes ?? []).find((t) => t.id === slug || t.name === slug);
  if (row === undefined) throw new Error(`No tribes row named "${slug}" in ${contentDir}/ir.json`);
  return row.typeId;
}

const fromTribeId = tribeIdBySlug(fromId);
const buildingsTribeId = buildingsId === fromId ? fromTribeId : tribeIdBySlug(buildingsId);
const freeIds = [...usedTribeIds()].sort((a, b) => a - b);
const peopleTribeId = args['type-id'] !== undefined ? Number(args['type-id']) : freeIds.at(-1) + 1;
if (!Number.isInteger(peopleTribeId) || peopleTribeId <= 0) {
  throw new Error(`--type-id must be a positive integer, got ${String(args['type-id'])}`);
}
if (freeIds.includes(peopleTribeId)) {
  throw new Error(`Tribe id ${peopleTribeId} is already in use; pass another with --type-id`);
}

/** The source people's rules row, re-identified and flagged: this is the whole sim side of the pack. */
const sourceTribe = (ir.tribes ?? []).find((t) => t.typeId === fromTribeId);
if (sourceTribe === undefined) throw new Error(`No tribes row for tribe id ${fromTribeId}`);

const lanes = {};
const summary = [];

// --- The people: rules ---------------------------------------------------------------

const tribeRow = {
  ...sourceTribe,
  typeId: peopleTribeId,
  id: peopleId,
  name: peopleName,
  civilization: true,
};
lanes.tribes = [tribeRow];
summary.push(`tribes: 1 row (typeId ${peopleTribeId}, id "${peopleId}", civilization)`);

// The class weapons are keyed `(tribeType, typeId)`, and a mod row joins by `id` and `typeId`, so each
// clone renames its id to keep the source tribe's row and its own apart.
const sourceWeapons = (ir.weapons ?? []).filter((w) => w.tribeType === fromTribeId);
if (sourceWeapons.length > 0) {
  lanes.weapons = sourceWeapons.map((w) => ({ ...w, tribeType: peopleTribeId, id: `${peopleId}_${w.id}` }));
  summary.push(`weapons: ${lanes.weapons.length} rows (class weapons of the ${fromId})`);
}

// One name pool per sex; a people without pools names nobody.
const sourcePools = (ir.personalNames ?? []).filter((p) => p.tribe === fromTribeId);
if (sourcePools.length > 0) {
  lanes.personalNames = sourcePools.map((p) => ({ ...p, tribe: peopleTribeId, id: `${peopleId}-${p.sex}` }));
  summary.push(`personalNames: ${lanes.personalNames.length} pools`);
}

// The shouted attack alert and the settler voices are authored per-tribe pools. The pack's `sounds`
// object merges whole - zod's bank defaults would empty the untouched tables - so it repeats the base
// bank with the people's rows added.
const sourceAlerts = (ir.sounds?.attackAlerts ?? []).filter((a) => a.tribe === fromTribeId);
const sourceVoices = (ir.sounds?.humanVoices ?? []).filter((v) => v.tribe === fromTribeId);
if (sourceAlerts.length + sourceVoices.length > 0 && ir.sounds !== undefined) {
  lanes.sounds = {
    ...ir.sounds,
    attackAlerts: [
      ...(ir.sounds?.attackAlerts ?? []),
      ...sourceAlerts.map((a) => ({ ...a, tribe: peopleTribeId })),
    ],
    humanVoices: [
      ...(ir.sounds?.humanVoices ?? []),
      ...sourceVoices.map((v) => ({ ...v, tribe: peopleTribeId })),
    ],
  };
  summary.push(
    `sounds: the base bank with ${sourceAlerts.length} alert voice(s) and ${sourceVoices.length} settler voice row(s) for the people`,
  );
}

// --- The buildings: another tribe's house art -----------------------------------------

// The `[GfxHouse]` joins key on `(tribeId, typeId)`; cloning the building tribe's rows onto the new
// tribe id draws its houses. The rows carry their own provenance, which stays faithful to the source.
const HOUSE_LANES = [
  'buildingBobs',
  'constructionLayers',
  'buildingOverlays',
  'buildingLandscapeOverlays',
  'buildingFlagPoints',
  'buildingSoldierFlagPoints',
  'buildingHolyFirePoints',
];
for (const lane of HOUSE_LANES) {
  const rows = (ir[lane] ?? []).filter((r) => r.tribeId === buildingsTribeId);
  if (rows.length === 0) continue;
  lanes[lane] = rows.map((r) => ({ ...r, tribeId: peopleTribeId }));
  summary.push(`${lane}: ${rows.length} rows (the ${buildingsId} house art)`);
}

// Where the building tribe stands a type on its own footprint (or carries its own hitpoints), the new
// people takes the same variant. Arrays replace on merge, so each touched row repeats the base
// entries beside the added one.
const buildingRows = (ir.buildings ?? []).filter(
  (b) =>
    (b.tribeVariants ?? []).some((v) => v.tribe === buildingsTribeId) ||
    (b.recordFootprints ?? []).some((r) => r.tribe === buildingsTribeId),
);
if (buildingRows.length > 0) {
  lanes.buildings = buildingRows.map((b) => {
    const own = (b.tribeVariants ?? []).filter((v) => v.tribe === buildingsTribeId);
    const ownRecords = (b.recordFootprints ?? []).filter((r) => r.tribe === buildingsTribeId);
    // The source tribe keeps its own variant; the people gains a copy of it beside the base entries.
    return {
      ...b,
      tribeVariants: [...(b.tribeVariants ?? []), ...own.map((v) => ({ ...v, tribe: peopleTribeId }))],
      recordFootprints: [
        ...(b.recordFootprints ?? []),
        ...ownRecords.map((r) => ({ ...r, tribe: peopleTribeId })),
      ],
    };
  });
  summary.push(`buildings: ${buildingRows.length} rows gain the people's own footprint/hitpoint variant`);
}

// --- The ZIP ---------------------------------------------------------------------------

// A minimal stored (uncompressed) ZIP: the pack is a single JSON file, and the game's importer reads
// stored entries as readily as deflated ones.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(name, bytes) {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(bytes);
  const local = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(local.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, 0x0800, true); // UTF-8 names
  view.setUint16(8, 0, true); // stored
  view.setUint32(14, crc, true);
  view.setUint32(18, bytes.length, true);
  view.setUint32(22, bytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cview = new DataView(central.buffer);
  cview.setUint32(0, 0x02014b50, true);
  cview.setUint16(4, 20, true);
  cview.setUint16(6, 20, true);
  cview.setUint16(8, 0x0800, true);
  cview.setUint16(10, 0, true);
  cview.setUint32(16, crc, true);
  cview.setUint32(20, bytes.length, true);
  cview.setUint32(24, bytes.length, true);
  cview.setUint16(28, nameBytes.length, true);
  cview.setUint32(42, 0, true); // local header offset
  central.set(nameBytes, 46);
  return { local, central };
}

const irJson = new TextEncoder().encode(`${JSON.stringify(lanes, null, 2)}\n`);
const entry = zipStored('ir.json', irJson);
const end = new Uint8Array(22);
const endView = new DataView(end.buffer);
endView.setUint32(0, 0x06054b50, true);
endView.setUint16(8, 1, true);
endView.setUint16(10, 1, true);
endView.setUint32(12, entry.central.length, true);
// The central directory sits behind the local header and the file data it describes.
endView.setUint32(16, entry.local.length + irJson.length, true);
const zip = new Uint8Array(entry.local.length + irJson.length + entry.central.length + end.length);
zip.set(entry.local, 0);
zip.set(irJson, entry.local.length);
zip.set(entry.central, entry.local.length + irJson.length);
zip.set(end, entry.local.length + irJson.length + entry.central.length);

writeFileSync(outPath, zip);
const sha256 = createHash('sha256').update(zip).digest('hex').slice(0, 12);
console.log(`Wrote ${outPath} (${(zip.length / 1024).toFixed(0)} KiB, ${sha256})`);
console.log(`  people: ${peopleName} (typeId ${peopleTribeId}); settlers like the ${fromId},`);
console.log(`  buildings like the ${buildingsId}. Enable the pack on the Mods screen.`);
for (const line of summary) console.log(`  - ${line}`);
