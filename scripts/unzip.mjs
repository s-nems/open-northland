/**
 * Extracts a zip archive with Node alone. The mod archive stores its Polish folder names in a DOS
 * code page with the UTF-8 spelling in the Info-ZIP Unicode Path field, which the system unzip of
 * one platform refuses and another mangles; reading the field here gives every platform the same
 * tree. Stored and deflated entries, no zip64.
 */

import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

// Byte offsets of the fields read from each fixed-size record; the names follow the zip format's
// application note.
const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const END = { entryCount: 10, directorySize: 12, directoryOffset: 16 };
const MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const CENTRAL = {
  flags: 8,
  method: 10,
  crc: 16,
  compressedSize: 20,
  size: 24,
  nameLength: 28,
  extraLength: 30,
  commentLength: 32,
  localOffset: 42,
};
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
const LOCAL = { nameLength: 26, extraLength: 28 };
const EXTRA_FIELD_HEADER = 4;
const EXTRA_FIELD_SIZE = 2;
const ZIP64_MARKER = 0xffffffff;
const FLAG_UTF8_NAME = 0x800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const UNICODE_PATH_FIELD = 0x7075;
const UNICODE_PATH_VERSION = 1;
const UNICODE_PATH_HEADER = 5;

async function readAt(file, position, length) {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await file.read(buffer, filled, length - filled, position + filled);
    if (bytesRead === 0) throw new Error(`zip: truncated at byte ${position + filled}`);
    filled += bytesRead;
  }
  return buffer;
}

/** The UTF-8 name from the Unicode Path field, when its checksum matches the header's name. */
function unicodePath(extra, rawName) {
  for (let at = 0; at + EXTRA_FIELD_HEADER <= extra.length; ) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + EXTRA_FIELD_SIZE);
    const field = extra.subarray(at + EXTRA_FIELD_HEADER, at + EXTRA_FIELD_HEADER + size);
    if (
      id === UNICODE_PATH_FIELD &&
      field.length >= UNICODE_PATH_HEADER &&
      field[0] === UNICODE_PATH_VERSION &&
      field.readUInt32LE(1) === crc32(rawName)
    ) {
      return field.subarray(UNICODE_PATH_HEADER).toString('utf8');
    }
    at += EXTRA_FIELD_HEADER + size;
  }
  return undefined;
}

function entryName(flags, rawName, extra) {
  if (flags & FLAG_UTF8_NAME) return rawName.toString('utf8');
  const unicode = unicodePath(extra, rawName);
  if (unicode !== undefined) return unicode;
  if (rawName.every((byte) => byte < 0x80)) return rawName.toString('ascii');
  throw new Error(`zip: entry name in an unknown code page: ${rawName.toString('latin1')}`);
}

async function readCentralDirectory(file) {
  const { size } = await file.stat();
  const tailLength = Math.min(size, END_SIZE + MAX_COMMENT_LENGTH);
  const tail = await readAt(file, size - tailLength, tailLength);
  let end = tail.length - END_SIZE;
  while (end >= 0 && tail.readUInt32LE(end) !== END_SIGNATURE) end -= 1;
  if (end < 0) throw new Error('zip: no end-of-central-directory record');
  const count = tail.readUInt16LE(end + END.entryCount);
  const directorySize = tail.readUInt32LE(end + END.directorySize);
  const directoryOffset = tail.readUInt32LE(end + END.directoryOffset);
  if (count === 0xffff || directoryOffset === ZIP64_MARKER)
    throw new Error('zip: zip64 archives are not supported');

  const directory = await readAt(file, directoryOffset, directorySize);
  const entries = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE)
      throw new Error(`zip: bad central directory entry ${index}`);
    const nameLength = directory.readUInt16LE(at + CENTRAL.nameLength);
    const extraLength = directory.readUInt16LE(at + CENTRAL.extraLength);
    const commentLength = directory.readUInt16LE(at + CENTRAL.commentLength);
    const rawName = directory.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength);
    const extra = directory.subarray(
      at + CENTRAL_SIZE + nameLength,
      at + CENTRAL_SIZE + nameLength + extraLength,
    );
    entries.push({
      name: entryName(directory.readUInt16LE(at + CENTRAL.flags), rawName, extra),
      method: directory.readUInt16LE(at + CENTRAL.method),
      crc: directory.readUInt32LE(at + CENTRAL.crc),
      compressedSize: directory.readUInt32LE(at + CENTRAL.compressedSize),
      size: directory.readUInt32LE(at + CENTRAL.size),
      localOffset: directory.readUInt32LE(at + CENTRAL.localOffset),
    });
    at += CENTRAL_SIZE + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readEntry(file, entry) {
  const local = await readAt(file, entry.localOffset, LOCAL_SIZE);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`zip: bad local header for ${entry.name}`);
  const dataOffset =
    entry.localOffset +
    LOCAL_SIZE +
    local.readUInt16LE(LOCAL.nameLength) +
    local.readUInt16LE(LOCAL.extraLength);
  const compressed = await readAt(file, dataOffset, entry.compressedSize);
  let data;
  if (entry.method === METHOD_STORED) data = compressed;
  else if (entry.method === METHOD_DEFLATED) data = inflateRawSync(compressed);
  else throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`);
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw new Error(`zip: ${entry.name} does not match its recorded size and checksum`);
  }
  return data;
}

/** The entry's path under the target, refusing anything that could leave it. */
function entryPath(target, name) {
  const segments = name.split('/');
  if (segments[0] === '' || segments.some((segment) => segment === '..')) {
    throw new Error(`zip: refusing entry path ${name}`);
  }
  return join(target, ...segments);
}

export async function extractZip(archive, target) {
  const file = await open(archive);
  try {
    for (const entry of await readCentralDirectory(file)) {
      const path = entryPath(target, entry.name);
      if (entry.name.endsWith('/')) {
        await mkdir(path, { recursive: true });
        continue;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await readEntry(file, entry));
    }
  } finally {
    await file.close();
  }
}
