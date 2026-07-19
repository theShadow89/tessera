// Minimal ZIP writer (STORE method, no compression). Binary STLs don't compress
// much anyway, and this keeps one reliable download instead of many browser-
// blocked ones, with no dependency.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE) of a byte array. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
const u32 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

function concat(arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * Build a ZIP archive from a list of files, STORE (uncompressed).
 *
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @returns {Uint8Array} the archive bytes
 */
export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    // Local file header + name + data.
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), name, f.data,
    ]);
    chunks.push(local);

    // Central directory record (collected, appended after all locals).
    central.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset), name,
      ])
    );
    offset += local.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    chunks.push(c);
    cdSize += c.length;
  }

  // End of central directory.
  chunks.push(
    concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cdSize), u32(cdStart), u16(0),
    ])
  );

  return concat(chunks);
}
