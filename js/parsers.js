// Metadata parsers + lossless strippers. No dependencies, runs in browser and Node 18+.
// Everything operates on a Uint8Array of the original file. Nothing leaves the device.

import { TAGS, GPS_TAGS, INTEROP_TAGS, ENUMS, IPTC_TAGS } from './tags.js';
import { isVideo, parseVideo, stripVideo } from './video.js';
import { officeKind, parseOffice, cleanOffice } from './office.js';
import { isZip } from './zip.js';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const utf8 = new TextDecoder('utf-8');
const latin1 = new TextDecoder('latin1');

export const ascii = (b, off, len) => {
  let s = '';
  for (let i = off; i < off + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};
const startsWith = (b, off, str) => ascii(b, off, str.length) === str;

// ---------------------------------------------------------------- format detection
export function detectFormat(b) {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/avi[fs]/.test(brand)) return 'avif';
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brand)) return 'heif';
    if (isVideo(b)) return 'video';
    return 'isobmff';
  }
  if (isVideo(b)) return 'video';
  if (isZip(b)) return 'zip';
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return 'tiff';
  if (ascii(b, 0, 3) === 'GIF') return 'gif';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  return 'unknown';
}

// ---------------------------------------------------------------- TIFF / EXIF
function readTiffValue(b, dv, le, type, count, valOff, tiffStart, tiffEnd) {
  const size = TYPE_SIZE[type] || 1;
  const total = size * count;
  if (valOff < tiffStart || valOff + total > tiffEnd) return { raw: null, bad: true };
  if (type === 2) {
    let s = '';
    for (let i = 0; i < count; i++) { const c = b[valOff + i]; if (c === 0) break; s += String.fromCharCode(c); }
    // re-decode as UTF-8 when possible (many cameras/phones write UTF-8 into ASCII fields)
    try { s = utf8.decode(b.subarray(valOff, valOff + Math.min(count, s.length))); } catch {}
    return { raw: s.trim() };
  }
  if (type === 1 || type === 7 || type === 6) {
    return { raw: b.subarray(valOff, valOff + count) };
  }
  const n = Math.min(count, 256); // cap huge arrays
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = valOff + i * size;
    switch (type) {
      case 3: out.push(dv.getUint16(o, le)); break;
      case 8: out.push(dv.getInt16(o, le)); break;
      case 4: out.push(dv.getUint32(o, le)); break;
      case 9: out.push(dv.getInt32(o, le)); break;
      case 5: out.push([dv.getUint32(o, le), dv.getUint32(o + 4, le)]); break;
      case 10: out.push([dv.getInt32(o, le), dv.getInt32(o + 4, le)]); break;
      case 11: out.push(dv.getFloat32(o, le)); break;
      case 12: out.push(dv.getFloat64(o, le)); break;
    }
  }
  return { raw: count === 1 ? out[0] : out, truncated: count > n };
}

const rat = (r) => (Array.isArray(r) ? (r[1] ? r[0] / r[1] : 0) : r);
const fmtNum = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(6)));

function displayValue(name, type, raw, count) {
  if (raw == null) return '';
  if (ENUMS[name] && typeof raw === 'number') return `${ENUMS[name][raw] ?? raw}`;
  if (name === 'Flash' && typeof raw === 'number') return raw & 1 ? 'Fired' : 'Did not fire';
  if (name === 'ExposureTime') { const v = rat(raw); return v && v < 1 ? `1/${Math.round(1 / v)} s` : `${fmtNum(v)} s`; }
  if (name === 'FNumber') return `f/${fmtNum(rat(raw))}`;
  if (name === 'FocalLength') return `${fmtNum(rat(raw))} mm`;
  if (/^GPS(Dest)?(Latitude|Longitude)$/.test(name) && Array.isArray(raw) && raw.length === 3)
    return `${fmtNum(rat(raw[0]))}° ${fmtNum(rat(raw[1]))}' ${fmtNum(+rat(raw[2]).toFixed(3))}"`;
  if (name === 'GPSAltitudeRef' && raw instanceof Uint8Array) return raw[0] === 1 ? 'Below sea level' : 'Above sea level';
  if (name === 'GPSAltitude') return `${fmtNum(+rat(raw).toFixed(2))} m`;
  if (name === 'GPSTimeStamp' && Array.isArray(raw) && raw.length === 3) return raw.map((v) => String(Math.floor(rat(v))).padStart(2, '0')).join(':') + ' UTC';
  if (raw instanceof Uint8Array) {
    if (/Version/.test(name)) return name === 'GPSVersionID' ? [...raw].join('.') : ascii(raw, 0, raw.length);
    if (name === 'UserComment' || name === 'GPSProcessingMethod') {
      const txt = raw.length > 8 ? ascii(raw, 8, raw.length - 8).replace(/\0/g, '').trim() : '';
      return txt || '(empty)';
    }
    if (/^XP/.test(name)) { // UCS-2 LE strings written by Windows
      let s = ''; for (let i = 0; i + 1 < raw.length; i += 2) { const c = raw[i] | (raw[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    if (raw.length > 32) return `[${raw.length} bytes of binary data]`;
    return [...raw].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  }
  if (Array.isArray(raw) && raw.length === 2 && (type === 5 || type === 10) && typeof raw[0] === 'number') return fmtNum(rat(raw));
  if (Array.isArray(raw)) {
    const parts = raw.slice(0, 16).map((v) => (Array.isArray(v) ? fmtNum(rat(v)) : fmtNum(v)));
    return parts.join(', ') + (raw.length > 16 || count > raw.length ? ` … (${count} values)` : '');
  }
  return typeof raw === 'number' ? fmtNum(raw) : String(raw);
}

/** Parse a TIFF structure (EXIF block or whole .tif). Returns { groups, gps, thumbnail, orientation } */
export function parseTiff(b, start, end = b.length) {
  const res = { groups: [], gps: null, thumbnail: null, orientation: null, errors: [] };
  if (end - start < 8) return res;
  const bo = ascii(b, start, 2);
  if (bo !== 'II' && bo !== 'MM') { res.errors.push('Bad TIFF byte order'); return res; }
  const le = bo === 'II';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const seen = new Set();

  const readIFD = (relOff, groupName, dict) => {
    const off = start + relOff;
    if (relOff <= 0 || off + 2 > end || seen.has(off)) return { entries: [], next: 0, pointers: {} };
    seen.add(off);
    const n = dv.getUint16(off, le);
    if (n > 1000 || off + 2 + n * 12 > end) return { entries: [], next: 0, pointers: {} };
    const entries = []; const pointers = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
      const size = (TYPE_SIZE[type] || 1) * count;
      const valOff = size <= 4 ? e + 8 : start + dv.getUint32(e + 8, le);
      if (tag === 0x8769 || tag === 0x8825 || tag === 0xa005) { pointers[tag] = dv.getUint32(e + 8, le); continue; }
      const name = dict[tag] || `Tag 0x${tag.toString(16).padStart(4, '0')}`;
      const { raw, bad } = readTiffValue(b, dv, le, type, count, valOff, start, end);
      if (bad) continue;
      entries.push({ tag, name, type, raw, value: displayValue(name, type, raw, count) });
    }
    const nextPos = off + 2 + n * 12;
    const next = nextPos + 4 <= end ? dv.getUint32(nextPos, le) : 0;
    if (entries.length) res.groups.push({ name: groupName, entries });
    return { entries, next, pointers };
  };

  const ifd0 = readIFD(dv.getUint32(start + 4, le), 'Main image (IFD0)', TAGS);
  const ori = ifd0.entries.find((e) => e.tag === 0x0112);
  if (ori) res.orientation = ori.raw;
  if (ifd0.pointers[0x8769]) {
    const ex = readIFD(ifd0.pointers[0x8769], 'Camera & capture (EXIF)', TAGS);
    if (ex.pointers[0xa005]) readIFD(ex.pointers[0xa005], 'Interoperability', INTEROP_TAGS);
  }
  if (ifd0.pointers[0x8825]) {
    const g = readIFD(ifd0.pointers[0x8825], 'Location (GPS)', GPS_TAGS);
    res.gps = gpsFromEntries(g.entries);
  }
  if (ifd0.next) {
    const ifd1 = readIFD(ifd0.next, 'Embedded thumbnail (IFD1)', TAGS);
    const tOff = ifd1.entries.find((e) => e.tag === 0x0201)?.raw;
    const tLen = ifd1.entries.find((e) => e.tag === 0x0202)?.raw;
    if (tOff && tLen && start + tOff + tLen <= end) res.thumbnail = b.slice(start + tOff, start + tOff + tLen);
  }
  return res;
}

function gpsFromEntries(entries) {
  const get = (n) => entries.find((e) => e.name === n)?.raw;
  const dms = (v) => (Array.isArray(v) && v.length >= 3 ? rat(v[0]) + rat(v[1]) / 60 + rat(v[2]) / 3600 : null);
  let lat = dms(get('GPSLatitude')), lon = dms(get('GPSLongitude'));
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  if (/S/i.test(get('GPSLatitudeRef') || '')) lat = -lat;
  if (/W/i.test(get('GPSLongitudeRef') || '')) lon = -lon;
  const altRaw = get('GPSAltitude');
  let alt = altRaw != null ? rat(altRaw) : null;
  const altRef = get('GPSAltitudeRef');
  if (alt != null && altRef instanceof Uint8Array && altRef[0] === 1) alt = -alt;
  return { lat: +lat.toFixed(6), lon: +lon.toFixed(6), alt: alt != null ? +alt.toFixed(1) : null };
}

// ---------------------------------------------------------------- XMP
export function parseXmp(xml) {
  const entries = [];
  if (typeof DOMParser === 'undefined') {
    // Node / fallback: crude attribute + element scrape
    const re = /([A-Za-z]+:[A-Za-z]+)(?:="([^"]*)"|>([^<]{1,500})<\/\1>)/g;
    let m;
    while ((m = re.exec(xml)) && entries.length < 300) {
      if (/^(xmlns|rdf|x):/.test(m[1])) continue;
      const v = (m[2] ?? m[3] ?? '').trim();
      if (v) entries.push({ name: m[1], value: v });
    }
    return entries;
  }
  const doc = new DOMParser().parseFromString(xml.replace(/^[^<]*/, ''), 'application/xml');
  if (doc.querySelector('parsererror')) return [{ name: 'XMP', value: '(could not parse XMP; see raw view)' }];
  const walk = (el, path) => {
    if (entries.length >= 300) return;
    for (const a of el.attributes || []) {
      if (a.name.startsWith('xmlns') || a.name.startsWith('rdf:') || a.name.startsWith('x:')) continue;
      entries.push({ name: a.name, value: a.value });
    }
    const kids = [...el.children];
    if (!kids.length) {
      const t = el.textContent.trim();
      if (t && !/^(rdf|x):/.test(el.tagName)) entries.push({ name: path || el.tagName, value: t });
      return;
    }
    for (const k of kids) {
      const structural = /^rdf:(RDF|Description|Seq|Bag|Alt|li)$|^x:xmpmeta$/.test(k.tagName);
      walk(k, structural ? path : k.tagName);
    }
  };
  walk(doc.documentElement, '');
  return entries;
}

// ---------------------------------------------------------------- JPEG
/** Walk JPEG segments, including entropy-coded data, yielding {marker, start, end, kind} */
function* walkJpeg(b) {
  let i = 2;
  const n = b.length;
  while (i < n - 1) {
    if (b[i] !== 0xff) { yield { marker: -1, start: i, end: n, kind: 'garbage' }; return; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd9) { yield { marker: m, start: i, end: i + 2, kind: 'EOI' }; if (i + 2 < n) yield { marker: -2, start: i + 2, end: n, kind: 'trailer' }; return; }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { yield { marker: m, start: i, end: i + 2, kind: 'standalone' }; i += 2; continue; }
    if (i + 4 > n) return;
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = Math.min(n, i + 2 + len);
    yield { marker: m, start: i, end, kind: 'segment' };
    i = end;
    if (m === 0xda) { // scan data runs until next real marker
      let j = i;
      while (j < n - 1) {
        if (b[j] === 0xff) {
          const c = b[j + 1];
          if (c === 0x00 || (c >= 0xd0 && c <= 0xd7)) { j += 2; continue; }
          if (c === 0xff) { j++; continue; }
          break;
        }
        j++;
      }
      yield { marker: -3, start: i, end: j, kind: 'scan' };
      i = j;
    }
  }
}

function app1Kind(b, s) {
  const d = s + 4;
  if (startsWith(b, d, 'Exif\0')) return 'exif';
  if (startsWith(b, d, 'http://ns.adobe.com/xap/1.0/\0')) return 'xmp';
  if (startsWith(b, d, 'http://ns.adobe.com/xmp/extension/\0')) return 'xmp-ext';
  return 'other';
}

function parseIptc(b, s, e) {
  const entries = [];
  for (let i = s; i < e - 5; i++) {
    if (b[i] === 0x1c && b[i + 1] === 0x02) {
      const ds = b[i + 2], len = (b[i + 3] << 8) | b[i + 4];
      if (len > 0x7fff || i + 5 + len > e) continue;
      if (ds !== 0) {
        let v; try { v = utf8.decode(b.subarray(i + 5, i + 5 + len)); } catch { v = latin1.decode(b.subarray(i + 5, i + 5 + len)); }
        entries.push({ name: IPTC_TAGS[ds] || `IPTC 2:${ds}`, value: v.replace(/\0/g, '').trim() });
      }
      i += 4 + len;
    }
  }
  return entries;
}

export function parseJpeg(b) {
  const r = baseReport('jpeg');
  const xmpParts = [];
  let lastEOI = false;
  for (const seg of walkJpeg(b)) {
    const { marker: m, start: s, end: e } = seg;
    if (seg.kind === 'trailer') {
      const extra = e - s;
      const hasJpeg = indexOf(b, [0xff, 0xd8, 0xff], s) !== -1;
      r.notes.push({ level: 'high', text: `${extra.toLocaleString()} bytes are hidden after the end of the image${hasJpeg ? ', including another embedded JPEG (often a depth map, motion photo or original before edits)' : ''}. Stripping removes them.` });
      r.hiddenBytes = extra;
      continue;
    }
    if (seg.kind === 'EOI') { lastEOI = true; continue; }
    if (seg.kind !== 'segment') continue;
    r.segments.push({ marker: `0x${m.toString(16).toUpperCase()}`, size: e - s });
    if (m === 0xe1) {
      const kind = app1Kind(b, s);
      if (kind === 'exif') Object.assign(r, mergeTiff(r, parseTiff(b, s + 10, e)));
      else if (kind === 'xmp') xmpParts.push(utf8.decode(b.subarray(s + 4 + 29, e)));
      else if (kind === 'xmp-ext') r.notes.push({ level: 'med', text: 'Extended XMP block present (large edit history or embedded data).' });
    } else if (m === 0xed && startsWith(b, s + 4, 'Photoshop 3.0')) {
      const iptc = parseIptc(b, s + 4, e);
      if (iptc.length) r.groups.push({ name: 'IPTC (news/photo agency fields)', entries: iptc });
    } else if (m === 0xe2 && startsWith(b, s + 4, 'ICC_PROFILE')) {
      r.icc = true;
      const desc = iccDescription(b, s + 18, e);
      r.groups.push({ name: 'Color profile (ICC)', entries: [{ name: 'ProfileDescription', value: desc || 'Embedded ICC profile' }] });
    } else if (m === 0xe2 && startsWith(b, s + 4, 'MPF')) {
      r.notes.push({ level: 'high', text: 'Multi-Picture Format block: this file carries extra images (e.g. depth map or burst). They are removed when stripped.' });
    } else if (m === 0xfe) {
      const txt = latin1.decode(b.subarray(s + 4, e)).replace(/\0/g, '').trim();
      if (txt) r.groups.push({ name: 'Comment', entries: [{ name: 'Comment', value: txt }] });
    } else if (m >= 0xe3 && m <= 0xef && m !== 0xee) {
      const id = ascii(b, s + 4, 16).replace(/[^\x20-\x7e].*$/, '');
      r.groups.push({ name: `Vendor block APP${m - 0xe0}`, entries: [{ name: 'Identifier', value: id || '(unnamed)' }, { name: 'Size', value: `${e - s} bytes` }] });
    } else if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      r.width = (b[s + 7] << 8) | b[s + 8];
      r.height = (b[s + 5] << 8) | b[s + 6];
      r.progressive = m === 0xc2;
    }
  }
  if (!lastEOI) r.notes.push({ level: 'low', text: 'Image appears truncated (no end marker).' });
  addXmp(r, xmpParts.join('\n'));
  r.strip = 'lossless';
  return r;
}

function iccDescription(b, s, e) {
  // ICC tag table: find 'desc' tag
  const p = s; // profile start (after 'ICC_PROFILE\0' + seq bytes)
  if (e - p < 132) return '';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = dv.getUint32(p + 128);
  for (let i = 0; i < Math.min(count, 100); i++) {
    const t = p + 132 + i * 12;
    if (t + 12 > e) break;
    if (ascii(b, t, 4) === 'desc') {
      const off = p + dv.getUint32(t + 4);
      if (off + 12 > e) return '';
      const type = ascii(b, off, 4);
      if (type === 'desc') { const l = dv.getUint32(off + 8); return ascii(b, off + 12, Math.min(l, 200)).replace(/\0/g, ''); }
      if (type === 'mluc') {
        const strLen = dv.getUint32(off + 20), strOff = dv.getUint32(off + 24);
        let out = ''; for (let k = 0; k < strLen && off + strOff + k + 1 < e; k += 2) out += String.fromCharCode(dv.getUint16(off + strOff + k));
        return out.replace(/\0/g, '');
      }
    }
  }
  return '';
}

function buildOrientationApp1(o) {
  const out = new Uint8Array(36);
  out.set([0xff, 0xe1, 0x00, 34]);
  out.set([...'Exif'].map((c) => c.charCodeAt(0)), 4);
  out.set([0, 0, 0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0], 8);
  return out;
}

export function stripJpeg(b, { keepOrientation = true, keepICC = true } = {}) {
  const parts = [new Uint8Array([0xff, 0xd8])];
  let orientation = null;
  for (const seg of walkJpeg(b)) {
    if (seg.kind === 'segment' && seg.marker === 0xe1 && app1Kind(b, seg.start) === 'exif') {
      orientation = parseTiff(b, seg.start + 10, seg.end).orientation;
      break;
    }
  }
  if (keepOrientation && orientation && orientation > 1 && orientation <= 8) parts.push(buildOrientationApp1(orientation));
  for (const seg of walkJpeg(b)) {
    const { marker: m, start: s, end: e, kind } = seg;
    if (kind === 'trailer' || kind === 'garbage') continue;
    if (kind === 'EOI' || kind === 'scan' || kind === 'standalone') { parts.push(b.subarray(s, e)); continue; }
    let keep = false;
    if (m === 0xe0) keep = startsWith(b, s + 4, 'JFIF\0') && !hasJfifThumb(b, s);
    else if (m === 0xe2) keep = keepICC && startsWith(b, s + 4, 'ICC_PROFILE');
    else if (m === 0xee) keep = true; // Adobe color transform flag, needed to decode CMYK correctly
    else if (m >= 0xe1 && m <= 0xef) keep = false; // EXIF, XMP, MPF, vendor blocks
    else if (m === 0xfe || m === 0xed) keep = false; // comments, Photoshop/IPTC
    else keep = true; // DQT, DHT, SOFn, SOS, DRI, etc.
    if (keep) parts.push(b.subarray(s, e));
  }
  return concat(parts);
}
const hasJfifThumb = (b, s) => b[s + 16] > 0 && b[s + 17] > 0;

// ---------------------------------------------------------------- PNG
const PNG_SAFE = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI']);

function* walkPng(b) {
  let i = 8;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) return;
    yield { type, start: i, data: i + 8, len, end };
    i = end;
    if (type === 'IEND') { if (i < b.length) yield { type: '__trailer', start: i, end: b.length }; return; }
  }
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

export async function parsePng(b) {
  const r = baseReport('png');
  const text = [];
  for (const c of walkPng(b)) {
    if (c.type === '__trailer') {
      r.hiddenBytes = c.end - c.start;
      r.notes.push({ level: 'high', text: `${r.hiddenBytes.toLocaleString()} bytes are hidden after the end of the image. Stripping removes them.` });
      continue;
    }
    r.segments.push({ marker: c.type, size: c.len + 12 });
    const d = b.subarray(c.data, c.data + c.len);
    if (c.type === 'IHDR') { const dv = new DataView(d.buffer, d.byteOffset); r.width = dv.getUint32(0); r.height = dv.getUint32(4); }
    else if (c.type === 'tEXt') {
      const z = d.indexOf(0);
      text.push({ name: latin1.decode(d.subarray(0, z)), value: latin1.decode(d.subarray(z + 1)) });
    } else if (c.type === 'zTXt') {
      const z = d.indexOf(0);
      const inflated = await inflate(d.subarray(z + 2));
      text.push({ name: latin1.decode(d.subarray(0, z)), value: inflated ? latin1.decode(inflated) : '(compressed text)' });
    } else if (c.type === 'iTXt') {
      const z = d.indexOf(0);
      const key = latin1.decode(d.subarray(0, z));
      const compressed = d[z + 1] === 1;
      let p = z + 3;
      const langEnd = d.indexOf(0, p); p = langEnd + 1;
      const transEnd = d.indexOf(0, p); p = transEnd + 1;
      let body = d.subarray(p);
      if (compressed) body = (await inflate(body)) || new Uint8Array();
      const val = utf8.decode(body);
      if (key === 'XML:com.adobe.xmp') addXmp(r, val);
      else text.push({ name: key, value: val });
    } else if (c.type === 'eXIf') {
      Object.assign(r, mergeTiff(r, parseTiff(b, c.data, c.data + c.len)));
    } else if (c.type === 'tIME') {
      const dv = new DataView(d.buffer, d.byteOffset);
      text.push({ name: 'LastModified (tIME)', value: `${dv.getUint16(0)}-${pad(d[2])}-${pad(d[3])} ${pad(d[4])}:${pad(d[5])}:${pad(d[6])} UTC` });
    } else if (c.type === 'iCCP') {
      r.icc = true;
      const z = d.indexOf(0);
      text.push({ name: 'ICC profile name', value: latin1.decode(d.subarray(0, z)) });
    } else if (!PNG_SAFE.has(c.type)) {
      text.push({ name: `Chunk ${c.type}`, value: `${c.len} bytes (non-standard / ancillary)` });
    }
  }
  // ImageMagick stores EXIF as hex text "Raw profile type exif"
  for (const t of text) {
    if (/Raw profile type (exif|APP1)/i.test(t.name)) {
      const hex = t.value.split('\n').slice(3).join('').replace(/\s/g, '');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      const off = startsWith(bytes, 0, 'Exif') ? 6 : 0;
      Object.assign(r, mergeTiff(r, parseTiff(bytes, off, bytes.length)));
      t.value = `[hex-encoded EXIF, ${bytes.length} bytes, decoded above]`;
    } else if (t.value.length > 2000) t.value = t.value.slice(0, 2000) + ' …';
  }
  if (text.length) r.groups.push({ name: 'PNG text & ancillary chunks', entries: text });
  r.strip = 'lossless';
  return r;
}
const pad = (n) => String(n).padStart(2, '0');

export function stripPng(b, { keepICC = true } = {}) {
  const parts = [b.subarray(0, 8)];
  for (const c of walkPng(b)) {
    if (c.type === '__trailer') continue;
    if (PNG_SAFE.has(c.type) || (keepICC && c.type === 'iCCP')) parts.push(b.subarray(c.start, c.end));
  }
  return concat(parts);
}

// ---------------------------------------------------------------- WebP
function* walkRiff(b) {
  let i = 12;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = Math.min(b.length, 8 + dv.getUint32(4, true));
  while (i + 8 <= riffEnd) {
    const id = ascii(b, i, 4), size = dv.getUint32(i + 4, true);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return;
    yield { id, start: i, data: i + 8, size, end: Math.min(end, b.length) };
    i = end;
  }
  if (riffEnd < b.length) yield { id: '__trailer', start: riffEnd, end: b.length };
}

export function parseWebp(b) {
  const r = baseReport('webp');
  for (const c of walkRiff(b)) {
    if (c.id === '__trailer') { r.hiddenBytes = c.end - c.start; r.notes.push({ level: 'high', text: `${r.hiddenBytes} bytes hidden after the image data.` }); continue; }
    r.segments.push({ marker: c.id, size: c.size + 8 });
    if (c.id === 'EXIF') {
      const off = startsWith(b, c.data, 'Exif\0') ? 6 : 0;
      Object.assign(r, mergeTiff(r, parseTiff(b, c.data + off, c.data + c.size)));
    } else if (c.id === 'XMP ') addXmp(r, utf8.decode(b.subarray(c.data, c.data + c.size)));
    else if (c.id === 'ICCP') { r.icc = true; r.groups.push({ name: 'Color profile (ICC)', entries: [{ name: 'ICC profile', value: `${c.size} bytes` }] }); }
    else if (c.id === 'VP8X') { r.width = 1 + (b[c.data + 4] | (b[c.data + 5] << 8) | (b[c.data + 6] << 16)); r.height = 1 + (b[c.data + 7] | (b[c.data + 8] << 8) | (b[c.data + 9] << 16)); }
  }
  r.strip = 'lossless';
  return r;
}

export function stripWebp(b, { keepICC = true } = {}) {
  const parts = [];
  for (const c of walkRiff(b)) {
    if (c.id === '__trailer' || c.id === 'EXIF' || c.id === 'XMP ' || (!keepICC && c.id === 'ICCP')) continue;
    const chunk = b.slice(c.start, c.end);
    if (c.id === 'VP8X') chunk[8] &= ~(0x08 | 0x04 | (keepICC ? 0 : 0x20)); // clear EXIF/XMP(/ICC) flags
    parts.push(chunk);
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}


// ---------------------------------------------------------------- HEIC / HEIF / AVIF (ISO base media)
// iPhone photos keep metadata as *items* inside the `meta` box: an `Exif` item (4-byte offset, then TIFF)
// and an XMP item (`mime`, application/rdf+xml). `iloc` says where each item's bytes live (file or `idat`).
function* walkBoxes(b, start, end) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = start;
  while (i + 8 <= end) {
    let size = dv.getUint32(i), hdr = 8;
    const type = ascii(b, i + 4, 4);
    if (size === 1) { size = Number(dv.getBigUint64(i + 8)); hdr = 16; } else if (size === 0) size = end - i;
    if (size < hdr || i + size > end) return;
    yield { type, start: i, data: i + hdr, end: i + size };
    i += size;
  }
}
const cstr = (b, off, end) => { let e = off; while (e < end && b[e] !== 0) e++; return [latin1.decode(b.subarray(off, e)), e + 1]; };

function readHeifMeta(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const meta = [...walkBoxes(b, 0, b.length)].find((x) => x.type === 'meta');
  if (!meta) return null;
  const out = { items: new Map(), primary: null, props: [], assoc: new Map(), refs: [], idat: null };
  const ub = (o, n) => (n === 0 ? 0 : n === 2 ? dv.getUint16(o) : n === 4 ? dv.getUint32(o) : n === 8 ? Number(dv.getBigUint64(o)) : 0);
  for (const bx of walkBoxes(b, meta.data + 4, meta.end)) {
    const ver = b[bx.data];
    if (bx.type === 'pitm') out.primary = ver === 0 ? dv.getUint16(bx.data + 4) : dv.getUint32(bx.data + 4);
    else if (bx.type === 'idat') out.idat = bx.data;
    else if (bx.type === 'iinf') {
      const first = bx.data + 4 + (ver === 0 ? 2 : 4);
      for (const ie of walkBoxes(b, first, bx.end)) {
        if (ie.type !== 'infe') continue;
        const v = b[ie.data]; let o = ie.data + 4;
        if (v < 2) continue;
        const id = v === 2 ? dv.getUint16(o) : dv.getUint32(o); o += v === 2 ? 2 : 4;
        o += 2; // protection index
        const itemType = ascii(b, o, 4); o += 4;
        const [name, o2] = cstr(b, o, ie.end); let contentType = '';
        if (itemType === 'mime') [contentType] = cstr(b, o2, ie.end);
        const it = out.items.get(id) || { id, extents: [] };
        Object.assign(it, { type: itemType, name, contentType, hidden: (b[ie.data + 3] & 1) === 1 });
        out.items.set(id, it);
      }
    } else if (bx.type === 'iloc') {
      let o = bx.data + 4;
      const offSize = b[o] >> 4, lenSize = b[o] & 15, baseSize = b[o + 1] >> 4, idxSize = ver === 1 || ver === 2 ? b[o + 1] & 15 : 0; o += 2;
      const count = ver < 2 ? dv.getUint16(o) : dv.getUint32(o); o += ver < 2 ? 2 : 4;
      for (let k = 0; k < count && o < bx.end; k++) {
        const id = ver < 2 ? dv.getUint16(o) : dv.getUint32(o); o += ver < 2 ? 2 : 4;
        let method = 0;
        if (ver === 1 || ver === 2) { method = dv.getUint16(o) & 15; o += 2; }
        o += 2; // data reference index
        const base = ub(o, baseSize); o += baseSize;
        const n = dv.getUint16(o); o += 2;
        const it = out.items.get(id) || { id, extents: [] };
        it.method = method;
        for (let e = 0; e < n; e++) {
          if (idxSize) o += idxSize;
          const off = ub(o, offSize); o += offSize;
          const len = ub(o, lenSize); o += lenSize;
          it.extents.push({ off: base + off, len });
        }
        out.items.set(id, it);
      }
    } else if (bx.type === 'iref') {
      for (const r of walkBoxes(b, bx.data + 4, bx.end)) {
        let o = r.data; const w = ver === 0 ? 2 : 4; const rd = (x) => (w === 2 ? dv.getUint16(x) : dv.getUint32(x));
        const from = rd(o); o += w; const n = dv.getUint16(o); o += 2;
        for (let k = 0; k < n; k++) { out.refs.push({ type: r.type, from, to: rd(o) }); o += w; }
      }
    } else if (bx.type === 'iprp') {
      for (const p of walkBoxes(b, bx.data, bx.end)) {
        if (p.type === 'ipco') for (const pr of walkBoxes(b, p.data, p.end)) out.props.push(pr);
        if (p.type === 'ipma') {
          const pv = b[p.data], flags = b[p.data + 3];
          let o = p.data + 4; const n = dv.getUint32(o); o += 4;
          for (let k = 0; k < n && o < p.end; k++) {
            const id = pv < 1 ? dv.getUint16(o) : dv.getUint32(o); o += pv < 1 ? 2 : 4;
            const m = b[o++]; const list = [];
            for (let j = 0; j < m; j++) { if (flags & 1) { list.push(dv.getUint16(o) & 0x7fff); o += 2; } else { list.push(b[o] & 0x7f); o++; } }
            out.assoc.set(id, list);
          }
        }
      }
    }
  }
  return out;
}
function itemBytes(b, meta, it) {
  // returns [{start,len}] absolute ranges in the file
  return it.extents.map((e) => ({ start: (it.method === 1 ? meta.idat : 0) + e.off, len: e.len })).filter((r) => r.start >= 0 && r.start + r.len <= b.length);
}

export function parseHeif(b, format) {
  const r = baseReport(format);
  const m = readHeifMeta(b);
  if (!m) { r.notes.push({ level: 'low', text: 'No metadata box found in this file.' }); r.strip = 'reencode'; return r; }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const propsOf = (id) => (m.assoc.get(id) || []).map((i) => m.props[i - 1]).filter(Boolean);
  for (const p of propsOf(m.primary)) {
    if (p.type === 'ispe') { r.width = dv.getUint32(p.data + 4); r.height = dv.getUint32(p.data + 8); }
    if (p.type === 'irot') r.rotation = (b[p.data] & 3) * 90;
  }
  let images = 0, thumbs = 0, aux = [];
  for (const it of m.items.values()) {
    const ranges = itemBytes(b, m, it);
    if (it.type === 'Exif' && ranges.length) {
      const { start, len } = ranges[0];
      const skip = dv.getUint32(start);
      Object.assign(r, mergeTiff(r, parseTiff(b, start + 4 + skip, start + len)));
    } else if (it.type === 'mime' && /rdf\+xml|xmp/i.test(it.contentType) && ranges.length) {
      addXmp(r, utf8.decode(b.subarray(ranges[0].start, ranges[0].start + ranges[0].len)));
    } else if (it.type === 'hvc1' || it.type === 'av01' || it.type === 'grid' || it.type === 'jpeg') {
      images++;
      if (m.refs.some((x) => x.type === 'thmb' && x.from === it.id)) thumbs++;
      if (m.refs.some((x) => x.type === 'auxl' && x.from === it.id)) {
        const auxC = propsOf(it.id).find((p) => p.type === 'auxC');
        aux.push(auxC ? cstr(b, auxC.data + 4, auxC.end)[0] : 'auxiliary image');
      }
    }
  }
  const tiles = [...m.items.values()].filter((it) => it.type === 'hvc1' && it.hidden).length;
  if (thumbs) r.notes.push({ level: 'med', text: 'Contains an embedded thumbnail image. It is part of the picture and is kept when cleaning.' });
  const auxNames = aux.map((a) => (/depth|disparity/i.test(a) ? 'depth map' : /matte/i.test(a) ? 'portrait matte (a cut-out of people in the photo)' : /hdrgain/i.test(a) ? 'HDR gain map' : 'auxiliary image'));
  if (auxNames.length) r.notes.push({ level: 'med', text: `Also carries a ${[...new Set(auxNames)].join(', ')}. These are image layers rather than metadata, and are kept when cleaning.` });
  if (r.rotation) r.groups.push({ name: 'Image properties', entries: [{ name: 'Rotation (irot)', value: `${r.rotation}°` }] });
  r.heif = { tiles, images };
  r.strip = 'lossless';
  return r;
}

// Clean HEIC losslessly *in place*: Exif and XMP item bytes are overwritten with same-size empty blocks,
// so every offset in the file stays valid and no image data is touched.
export function stripHeif(b, { keepOrientation = true } = {}) {
  const out = b.slice();
  const m = readHeifMeta(out);
  if (!m) return out;
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (const it of m.items.values()) {
    for (const { start, len } of itemBytes(out, m, it)) {
      if (it.type === 'Exif') {
        const orient = keepOrientation ? parseTiff(out, start + 4 + dv.getUint32(start), start + len).orientation : null;
        out.fill(0, start, start + len);
        // 4-byte offset (6) + "Exif\0\0" + minimal big-endian TIFF with zero or one IFD entry
        const tiff = orient && orient > 1 && orient <= 8
          ? [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orient, 0, 0, 0, 0, 0, 0]
          : [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0];
        const blob = [0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        if (blob.length <= len) out.set(blob, start);
      } else if (it.type === 'mime' && /rdf\+xml|xmp/i.test(it.contentType)) {
        const empty = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>';
        out.fill(0x20, start, start + len); // XMP allows whitespace padding
        if (empty.length <= len) out.set([...empty].map((c) => c.charCodeAt(0)), start);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- PDF (view only)
export function parsePdf(b) {
  const r = baseReport('pdf');
  const s = latin1.decode(b);
  const info = [];
  const re = /\/(Title|Author|Subject|Keywords|Creator|Producer|CreationDate|ModDate|Company|Manager|SourceModified)\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(s)) && info.length < 100) {
    const v = decodePdfString(m[2]);
    const key = m[1] + '=' + v;
    if (!v || seen.has(key)) continue;
    seen.add(key);
    info.push({ name: m[1], value: v });
  }
  if (info.length) r.groups.push({ name: 'Document info', entries: info });
  const x = s.indexOf('<x:xmpmeta');
  if (x !== -1) { const xe = s.indexOf('</x:xmpmeta>', x); if (xe !== -1) addXmp(r, utf8.decode(b.subarray(x, xe + 12))); }
  const notes = (s.match(/\/Subtype\s*\/(Text|FreeText|Highlight|Popup)\b/g) || []).length;
  if (notes) r.notes.push({ level: 'med', text: `${notes} annotation${notes > 1 ? 's' : ''} (comments/highlights); their author names may be visible in PDF readers.` });
  if (/\/ObjStm/.test(s)) r.notes.push({ level: 'low', text: 'Some objects are stored compressed; metadata hidden inside them may not be shown or cleaned here.' });
  const revisions = (s.match(/%%EOF/g) || []).length;
  if (revisions > 1) r.notes.push({ level: 'med', text: `This PDF was saved ${revisions} times (incremental updates). Earlier versions of the content may still be inside the file.` });
  if (/\/FlateDecode/.test(s) && !info.length && x === -1) r.notes.push({ level: 'low', text: 'Metadata may be inside compressed object streams this viewer does not decompress.' });
  r.strip = 'lossless';
  return r;
}

// PDF cleaning, in place: every document-info string (in every saved revision) and every uncompressed XMP
// packet is overwritten with spaces of the *same length*, so the cross-reference offsets stay valid.
const PDF_KEYS = 'Title|Author|Subject|Keywords|Creator|Producer|CreationDate|ModDate|Company|Manager|SourceModified|AuthoringTool|Trapped';
export function stripPdf(b) {
  const out = b.slice();
  const s = latin1.decode(b);
  const re = new RegExp(`\\/(${PDF_KEYS})\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const valStart = m.index + m[0].length - m[2].length;
    const inner0 = valStart + 1, inner1 = valStart + m[2].length - 1;
    if (m[2][0] === '<') { for (let i = inner0; i < inner1; i++) out[i] = 0x30; } // <0000…> = empty bytes
    else out.fill(0x20, inner0, inner1);
  }
  let x = 0;
  while ((x = s.indexOf('<x:xmpmeta', x)) !== -1) {
    const e = s.indexOf('</x:xmpmeta>', x);
    if (e === -1) break;
    const end = e + 12, empty = '<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>';
    out.fill(0x20, x, end);
    if (empty.length <= end - x) for (let i = 0; i < empty.length; i++) out[x + i] = empty.charCodeAt(i);
    x = end;
  }
  return out;
}
function decodePdfString(t) {
  if (t.startsWith('<')) {
    const hex = t.slice(1, -1).replace(/\s/g, '');
    const bytes = []; for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) { let o = ''; for (let i = 2; i + 1 < bytes.length; i += 2) o += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]); return o; }
    return String.fromCharCode(...bytes);
  }
  let inner = t.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c)).replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  if (inner.charCodeAt(0) === 0xfe && inner.charCodeAt(1) === 0xff) {
    let o = ''; for (let i = 2; i + 1 < inner.length; i += 2) o += String.fromCharCode((inner.charCodeAt(i) << 8) | inner.charCodeAt(i + 1)); inner = o;
  }
  return inner.replace(/\0/g, '').trim();
}

// ---------------------------------------------------------------- shared helpers
function baseReport(format) {
  return { format, groups: [], gps: null, thumbnail: null, orientation: null, xmpRaw: null, notes: [], segments: [], icc: false, hiddenBytes: 0, strip: 'none' };
}
function mergeTiff(r, t) {
  return { groups: [...r.groups, ...t.groups], gps: r.gps || t.gps, thumbnail: r.thumbnail || t.thumbnail, orientation: r.orientation ?? t.orientation };
}
function addXmp(r, xml) {
  if (!xml || !xml.trim()) return;
  r.xmpRaw = (r.xmpRaw ? r.xmpRaw + '\n' : '') + xml;
  const entries = parseXmp(xml);
  if (entries.length) r.groups.push({ name: 'XMP (editing software & rights)', entries });
  // Photo apps (incl. iOS/Google) sometimes put GPS only in XMP
  if (!r.gps) {
    const lat = entries.find((e) => /GPSLatitude$/i.test(e.name))?.value, lon = entries.find((e) => /GPSLongitude$/i.test(e.name))?.value;
    const conv = (v) => { const m = /(\d+),(\d+(?:\.\d+)?)([NSEW])/.exec(v || ''); if (!m) return null; const d = +m[1] + +m[2] / 60; return /[SW]/.test(m[3]) ? -d : d; };
    const la = conv(lat), lo = conv(lon);
    if (la != null && lo != null) r.gps = { lat: +la.toFixed(6), lon: +lo.toFixed(6), alt: null };
  }
}
function indexOf(b, pat, from = 0) {
  outer: for (let i = from; i <= b.length - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer; return i; }
  return -1;
}
export function concat(parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------------------------------------------------------------- risk classification
export function classify(name) {
  const n = name.replace(/^[a-z]+:/i, '');
  if (/^GPS|latitude|longitude|location|city|country|province|state$|sublocation|altitude/i.test(n)) return 'location';
  if (/^GPS location|^Location/i.test(n)) return 'location';
  if (/serial|owner|artist|author|by-?line|^creator$|copyright|rights|credit|uniqueid|documentid|instanceid|usage ?terms|contact|e-?mail|company|manager|person|^name$|modified by|content identifier|template/i.test(n)) return 'identity';
  if (/^make$|model|lens|software|creatortool|producer|^creator$|host ?computer|firmware|^tool/i.test(n)) return 'device';
  if (/date|time|offset|lastmodified|recorded|created|saved|printed/i.test(n)) return 'time';
  if (/comment|description|caption|keyword|title|subject|headline|history|label|rating|instructions|^text$|chunk/i.test(n)) return 'content';
  return 'technical';
}
export const CATEGORY_INFO = {
  location: { label: 'Location', tag: 'GPS', risk: 'high', why: 'Where the photo was taken, often accurate to a few meters.' },
  identity: { label: 'Identity', tag: 'ID', risk: 'high', why: 'Names, serial numbers and unique IDs that can link files back to you or your device.' },
  device: { label: 'Device & software', tag: 'Device', risk: 'med', why: 'Your camera or phone model and the apps used to edit.' },
  time: { label: 'Timestamps', tag: 'Time', risk: 'med', why: 'Exact capture and edit times, sometimes with your time zone.' },
  content: { label: 'Text & history', tag: 'Text', risk: 'med', why: 'Captions, comments, keywords and edit history.' },
  technical: { label: 'Technical', tag: 'Tech', risk: 'low', why: 'Exposure, resolution and encoding details. Usually harmless.' },
};

// ---------------------------------------------------------------- entry point
export async function analyze(bytes) {
  const format = detectFormat(bytes);
  let r;
  switch (format) {
    case 'jpeg': r = parseJpeg(bytes); break;
    case 'png': r = await parsePng(bytes); break;
    case 'webp': r = parseWebp(bytes); break;
    case 'tiff': r = baseReport('tiff'); Object.assign(r, mergeTiff(r, parseTiff(bytes, 0, bytes.length))); r.strip = 'none';
      r.notes.push({ level: 'low', text: 'TIFF files can be inspected but not stripped in the browser.' }); break;
    case 'pdf': r = parsePdf(bytes); break;
    case 'video': r = parseVideo(bytes, baseReport('video')); break;
    case 'zip': {
      const kind = officeKind(bytes);
      if (kind) r = await parseOffice(bytes, baseReport(kind), kind, { analyzeImage: (b) => analyze(b) });
      else { r = baseReport('zip'); r.notes.push({ level: 'low', text: 'This is a ZIP archive. Open it and check the files inside individually.' }); }
      break;
    }
    case 'heif': case 'avif': case 'isobmff': r = parseHeif(bytes, format); break;
    case 'gif': r = baseReport('gif'); r.strip = 'reencode'; break;
    default: r = baseReport('unknown'); r.strip = 'none';
      r.notes.push({ level: 'low', text: 'Unrecognized file type.' });
  }
  for (const g of r.groups) for (const e of g.entries) e.category = classify(e.name);
  // GPS group entries are always location
  for (const g of r.groups) if (/GPS/.test(g.name)) for (const e of g.entries) e.category = 'location';
  for (const g of r.groups) if (/Interoperability|ICC/.test(g.name)) for (const e of g.entries) e.category = 'technical';
  r.counts = {};
  for (const g of r.groups) for (const e of g.entries) r.counts[e.category] = (r.counts[e.category] || 0) + 1;
  r.total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  return r;
}

export async function strip(bytes, format, opts = {}) {
  if (format === 'jpeg') return stripJpeg(bytes, opts);
  if (format === 'pdf') return stripPdf(bytes);
  if (format === 'video' || format === 'mov' || format === 'mp4') return stripVideo(bytes);
  if (format === 'docx' || format === 'xlsx' || format === 'pptx') return cleanOffice(bytes, opts, { stripImage: (b, f) => stripSync(b, f, { keepOrientation: true, keepICC: true }), detect: detectFormat });
  if (format === 'png') return stripPng(bytes, opts);
  if (format === 'webp') return stripWebp(bytes, opts);
  if (format === 'heif' || format === 'avif' || format === 'isobmff') return stripHeif(bytes, opts);
  throw new Error(`Lossless stripping not supported for ${format}`);
}

function stripSync(bytes, format, opts) {
  if (format === 'jpeg') return stripJpeg(bytes, opts);
  if (format === 'png') return stripPng(bytes, opts);
  if (format === 'webp') return stripWebp(bytes, opts);
  if (format === 'heif') return stripHeif(bytes, opts);
  return bytes;
}
