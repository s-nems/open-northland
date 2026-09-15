import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractZip } from '../unzip.mjs';

const STORED = 0;
const DEFLATED = 8;
const BZIP2 = 12;
const UNICODE_PATH_FIELD = 0x7075;
// Field header (id, size), then the version byte, then the checksum of the header name.
const UNICODE_PATH_CHECKSUM_OFFSET = 5;
const END_RECORD_SIZE = 22;
const END_ENTRY_COUNT_OFFSET = 10;

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
}
function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

/** The Info-ZIP Unicode Path field: version 1, the checksum of the header name, then UTF-8. */
function unicodePathField(rawName, unicodeName) {
  const utf8 = Buffer.from(unicodeName, 'utf8');
  const body = Buffer.concat([Buffer.from([1]), u32(crc32(rawName)), utf8]);
  return Buffer.concat([u16(UNICODE_PATH_FIELD), u16(body.length), body]);
}

/** A zip archive of `entries` ({ rawName, data, method, unicodeName }), directories named with a slash. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { rawName, data = Buffer.alloc(0), method = DEFLATED, unicodeName } of entries) {
    const name = Buffer.isBuffer(rawName) ? rawName : Buffer.from(rawName, 'latin1');
    const extra = unicodeName === undefined ? Buffer.alloc(0) : unicodePathField(name, unicodeName);
    const stored = method === STORED ? data : deflateRawSync(data);
    const fixed = Buffer.concat([
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc32(data)),
      u32(stored.length),
      u32(data.length),
    ]);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      fixed,
      u16(name.length),
      u16(extra.length),
      name,
      extra,
      stored,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(0),
        u16(20),
        fixed,
        u16(name.length),
        u16(extra.length),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
        extra,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, directory, end]);
}

async function extracted(archive) {
  const dir = await mkdtemp(join(tmpdir(), 'unzip-test-'));
  const zipPath = join(dir, 'archive.zip');
  await writeFile(zipPath, archive);
  const out = join(dir, 'out');
  try {
    await extractZip(zipPath, out);
    return { dir, out };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

test('extracts stored and deflated entries into their directories', async () => {
  const text = Buffer.from('Player 1 = human\n');
  const bytes = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
  const { dir, out } = await extracted(
    zip([
      { rawName: 'Mod/' },
      { rawName: 'Mod/maps/' },
      { rawName: 'Mod/maps/player.inc', data: text },
      { rawName: 'Mod/bin/map.dat', data: bytes, method: STORED },
    ]),
  );
  try {
    assert.deepEqual(await readFile(join(out, 'Mod/maps/player.inc')), text);
    assert.deepEqual(await readFile(join(out, 'Mod/bin/map.dat')), bytes);
    assert.deepEqual((await readdir(join(out, 'Mod'))).sort(), ['bin', 'maps']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('names an entry by its Unicode Path field over the code-page header name', async () => {
  const codePage852 = Buffer.from('Mod/Kraina Starych Bohater\xa2w/map.dat', 'latin1');
  const { dir, out } = await extracted(
    zip([
      { rawName: codePage852, unicodeName: 'Mod/Kraina Starych Bohaterów/map.dat', data: Buffer.from('x') },
    ]),
  );
  try {
    assert.deepEqual(await readdir(join(out, 'Mod')), ['Kraina Starych Bohaterów']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses a non-ASCII name that carries no Unicode Path field', async () => {
  const codePage852 = Buffer.from('Mod/Bohater\xa2w/map.dat', 'latin1');
  await assert.rejects(
    extracted(zip([{ rawName: codePage852, data: Buffer.from('x') }])),
    /unknown code page/,
  );
});

test('refuses an entry that would leave the target directory', async () => {
  await assert.rejects(
    extracted(zip([{ rawName: '../escape.txt', data: Buffer.from('x') }])),
    /refusing entry path/,
  );
  await assert.rejects(
    extracted(zip([{ rawName: '/etc/escape.txt', data: Buffer.from('x') }])),
    /refusing entry path/,
  );
  await assert.rejects(
    extracted(zip([{ rawName: 'a\\..\\..\\escape.txt', data: Buffer.from('x') }])),
    /refusing entry path/,
  );
});

test('keeps the header name when the Unicode Path checksum does not match it', async () => {
  const archive = zip([{ rawName: 'plain.txt', unicodeName: 'zły.txt', data: Buffer.from('x') }]);
  const fieldHeader = u16(UNICODE_PATH_FIELD);
  for (let at = archive.indexOf(fieldHeader); at !== -1; at = archive.indexOf(fieldHeader, at + 1)) {
    archive[at + UNICODE_PATH_CHECKSUM_OFFSET] ^= 0xff;
  }
  const { dir, out } = await extracted(archive);
  try {
    assert.deepEqual(await readdir(out), ['plain.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses a zip64 archive, an unknown compression method and a truncated file', async () => {
  const zip64 = zip([{ rawName: 'a.txt', data: Buffer.from('x') }]);
  zip64.writeUInt16LE(0xffff, zip64.length - END_RECORD_SIZE + END_ENTRY_COUNT_OFFSET);
  await assert.rejects(extracted(zip64), /zip64/);
  await assert.rejects(
    extracted(zip([{ rawName: 'a.txt', data: Buffer.from('x'), method: BZIP2 }])),
    /unsupported compression method 12/,
  );
  const whole = zip([{ rawName: 'a.txt', data: Buffer.from('x') }]);
  await assert.rejects(extracted(whole.subarray(0, whole.length - 1)), /end-of-central-directory/);
});

test('rejects data that does not match the recorded checksum', async () => {
  const archive = zip([{ rawName: 'a.txt', data: Buffer.from('hello'), method: STORED }]);
  archive.write('jello', archive.indexOf('hello'), 'latin1');
  await assert.rejects(extracted(archive), /checksum/);
});
