# CIF container

`.cif` files store compiled configuration and string tables. Open Northland implements the subset
needed by type tables, maps, and localized UI strings.

The layout below is verified against legally obtained game files and synthetic encoder/decoder
round-trip tests.

## Stored objects

A stored object begins with two little-endian words:

```text
u32 classId
u32 version
```

The pipeline currently recognizes these class ids:

| Id | Object |
| --- | --- |
| `0x3E9` | byte-memory block |
| `0x3F3` | bitmap |
| `0x3F4` | bob manager |
| `0x3F5` | bitmap font |
| `0x3F6` | palette |
| `0x3F7` | remap table |
| `0x3FD` | string array |

A memory block stores `u32 size` followed by `size` bytes.

## String arrays

Type tables and map logic use a `0x3FD` root with this body:

```text
u32 forceSequentialIds
u32 stringCount
u32 usedIdCount
u32 slotCount
u32 stringPoolUsedBytes
CMemory offsets
u8 hasStringPool
CMemory stringPool       # present when hasStringPool != 0
```

The offsets and string-pool memory blocks use the mode-1 byte transform before interpretation.
Decryption applies a position-dependent byte key:

```text
plain = (stored - 1) XOR key
```

The first pair uses keys `0x47` and `0xC5`. After each pair, the first key advances by the current
secondary key twice plus `0x21`, while the secondary key advances by `0x42`; all arithmetic wraps to
one byte. The inverse transform applies the XOR before adding one.

Offsets are little-endian `u32` values. `0xFFFFFFFF` denotes an unused slot. A valid entry points into
the NUL-separated string pool and is bounded by `stringPoolUsedBytes`, not the allocated buffer size.

Configuration strings may begin with a control byte below `0x20`. The pipeline preserves that byte as
the nesting level and decodes the remaining structural text as Latin-1. Display strings that contain
Central European characters are converted from CP1250 at the content layer.

## Tests

`tools/asset-pipeline/test/cif.test.ts` builds synthetic stored objects, encrypts their memory blocks,
and verifies the decoded header, holes, levels, text, and malformed boundaries. No captured `.cif`
file is committed.
