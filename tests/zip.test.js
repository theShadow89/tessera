import { describe, it, expect } from 'vitest';
import { crc32, zipStore } from '../src/geometry/zip.js';

const enc = new TextEncoder();

describe('crc32', () => {
  it('matches the standard test vector', () => {
    expect(crc32(enc.encode('123456789')) >>> 0).toBe(0xcbf43926);
  });
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStore', () => {
  const files = [
    { name: 'a.stl', data: enc.encode('hello') },
    { name: 'b.stl', data: enc.encode('world!!') },
  ];
  const zip = zipStore(files);

  it('starts with the local file header signature (PK\\x03\\x04)', () => {
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('ends with the end-of-central-directory signature (PK\\x05\\x06)', () => {
    // EOCD is the last 22 bytes (no comment).
    const e = zip.length - 22;
    expect([zip[e], zip[e + 1], zip[e + 2], zip[e + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    // total-entries field (offset e+10, u16) equals file count.
    expect(zip[e + 10] | (zip[e + 11] << 8)).toBe(2);
  });

  it('embeds both file names', () => {
    const text = new TextDecoder('latin1').decode(zip);
    expect(text).toContain('a.stl');
    expect(text).toContain('b.stl');
    // stored (uncompressed) data is present verbatim
    expect(text).toContain('hello');
    expect(text).toContain('world!!');
  });
});
