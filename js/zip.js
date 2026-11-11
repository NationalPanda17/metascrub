// Minimal ZIP reader/writer. No dependencies; uses the browser's (and Node 18+'s) built-in
// CompressionStream / DecompressionStream for deflate. Enough for Office files and batch downloads.
// Not supported: ZIP64 (files over 4 GB), encryption, multi-disk archives.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const inflateRaw = (b) => pipe(b, new DecompressionStream('deflate-raw'));
export const deflateRaw = (b) => pipe(b, new CompressionStream('deflate-raw'));

const utf8 = new TextDecoder('utf-8');
const enc = new TextEncoder();

export function isZip(b) { return b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; }

/** Returns [{ name, method, compressed, size, crc, read(): Promise<Uint8Array> }] in archive order */
export function readZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nl));
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const compressed = b.subarray(dataStart, dataStart + csize);
    entries.push({
      name, method, crc, size: usize, compressed,
      read: async () => (method === 0 ? compressed.slice() : method === 8 ? inflateRaw(compressed) : Promise.reject(new Error(`Unsupported ZIP method ${method}`))),
    });
    p += 46 + nl + el + cl;
  }
  return entries;
}

/**
 * files: [{ name, data: Uint8Array, store?: boolean }]. All timestamps are set to 1980-01-01,
 * so the archive itself doesn't leak when files were edited.
 */
export async function writeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let data = f.data, method = 0;
    if (!f.store && f.data.length > 64) {
      const d = await deflateRaw(f.data);
      if (d.length < f.data.length) { data = d; method = 8; }
    }
    const lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); // 1980-01-01 00:00
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    parts.push(lh, data); central.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
