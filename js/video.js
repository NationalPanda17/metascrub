// Video metadata (MOV / MP4 / M4V / 3GP): the ISO base media "box" format phones use.
// Where phones hide things:
//   moov/udta/©xyz ©mak ©mod ©swr ©day …   QuickTime strings (Samsung, older iPhones, many cameras)
//   moov[/udta]/meta  keys + ilst           Apple "mdta" keys: com.apple.quicktime.location.ISO6709, .make, .model …
//   moov/udta/meta/ilst ©too …              iTunes-style tags (encoder, title, …)
//   moov/udta/loci                          3GPP location (Android)
//   mvhd / tkhd / mdhd                      creation & modification times
// Cleaning is done in place: metadata boxes are renamed to `free` (a standard "ignore me" box) and zeroed,
// and timestamps are set to zero. Sizes never change, so every media offset stays valid. Nothing is re-encoded.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const ascii = (b, o, n) => latin1.decode(b.subarray(o, o + n));
const MAC_EPOCH = 2082844800; // seconds between 1904-01-01 and 1970-01-01
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'udta', 'edts', 'dinf', 'stbl']);
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';

const QT_NAMES = {
  '©xyz': 'Location (ISO 6709)', '©mak': 'Make', '©mod': 'Model', '©swr': 'Software', '©day': 'Date', '©nam': 'Title',
  '©cmt': 'Comment', '©des': 'Description', '©ART': 'Artist', '©aut': 'Author', '©too': 'Encoder', '©inf': 'Information',
  '©req': 'Requirements', '©fmt': 'Format', '©src': 'Source', '©wrt': 'Writer', '©prd': 'Producer', '©dir': 'Director',
  '©enc': 'Encoded by', '©cpy': 'Copyright', '©key': 'Keywords', '©alb': 'Album', 'cprt': 'Copyright',
};
const MDTA_NAMES = {
  'com.apple.quicktime.location.ISO6709': 'GPS location', 'com.apple.quicktime.make': 'Make', 'com.apple.quicktime.model': 'Model',
  'com.apple.quicktime.software': 'Software', 'com.apple.quicktime.creationdate': 'Creation date',
  'com.apple.quicktime.location.accuracy.horizontal': 'GPS accuracy (m)', 'com.apple.quicktime.content.identifier': 'Content identifier (links Live Photo pairs)',
  'com.apple.quicktime.camera.lens_model': 'Lens model', 'com.apple.quicktime.camera.focal_length.35mm_equivalent': 'Focal length (35mm)',
  'com.apple.quicktime.full-frame-rate-playback-intent': 'Playback intent', 'com.apple.quicktime.live-photo.auto': 'Live Photo',
  'com.apple.quicktime.author': 'Author', 'com.apple.quicktime.title': 'Title', 'com.apple.quicktime.description': 'Description',
  'com.android.version': 'Android version', 'com.android.capture.fps': 'Capture FPS', 'com.android.manufacturer': 'Make', 'com.android.model': 'Model',
};

function* boxes(b, start, end) {
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
// QuickTime `meta` has no version/flags; MP4 `meta` does. Detect by peeking for the hdlr box.
const metaChildStart = (b, m) => (ascii(b, m.data + 4, 4) === 'hdlr' ? m.data : m.data + 4);

export function isVideo(b) {
  if (b.length < 12) return false;
  const t = ascii(b, 4, 4);
  if (t === 'ftyp') {
    const brand = ascii(b, 8, 4);
    return /^(qt  |isom|iso\d|mp4\d|mp42|avc1|M4V |M4VH|M4VP|3gp\d|3g2\w|MSNV|dash|f4v )/.test(brand);
  }
  return ['moov', 'mdat', 'wide', 'free', 'skip'].includes(t) && [...boxes(b, 0, b.length)].some((x) => x.type === 'moov');
}

export function parseISO6709(s) {
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/.exec(s || '');
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (!lat && !lon) return null;
  return { lat: +lat.toFixed(6), lon: +lon.toFixed(6), alt: m[3] != null ? +(+m[3]).toFixed(1) : null };
}
const macTime = (secs) => (secs > 0 ? new Date((secs - MAC_EPOCH) * 1000) : null);
const fmtDate = (d) => (d && !isNaN(d) ? d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : null);

// Walk the whole movie and call back for every metadata-ish box we care about
function scan(b, cb) {
  const walk = (start, end, path) => {
    for (const x of boxes(b, start, end)) {
      const p = path ? `${path}/${x.type}` : x.type;
      if (x.type === 'meta') { cb('meta', x, p); continue; }
      if (x.type === 'uuid' && [...b.subarray(x.data, x.data + 16)].map((v) => v.toString(16).padStart(2, '0')).join('') === XMP_UUID) { cb('xmp', x, p); continue; }
      if (x.type === 'mvhd' || x.type === 'tkhd' || x.type === 'mdhd') cb('time', x, p);
      if (path.endsWith('udta') && x.type !== 'meta') cb('udta-item', x, p);
      if (CONTAINERS.has(x.type)) walk(x.data, x.end, p);
    }
  };
  walk(0, b.length, '');
}

export function parseVideo(b, base) {
  const r = base;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const brand = ascii(b, 4, 4) === 'ftyp' ? ascii(b, 8, 4).trim() : 'qt';
  r.format = brand === 'qt' ? 'mov' : 'mp4';
  r.isVideo = true;
  const device = [], place = [], times = [], text = [];
  let duration = null;
  scan(b, (kind, x, path) => {
    if (kind === 'time') {
      const v = b[x.data], o = x.data + 4;
      const created = v === 1 ? Number(dv.getBigUint64(o)) : dv.getUint32(o);
      const modified = v === 1 ? Number(dv.getBigUint64(o + 8)) : dv.getUint32(o + 4);
      if (x.type === 'mvhd') {
        const ts = v === 1 ? dv.getUint32(o + 16) : dv.getUint32(o + 8), dur = v === 1 ? Number(dv.getBigUint64(o + 20)) : dv.getUint32(o + 12);
        if (ts) duration = dur / ts;
        if (created) times.push({ name: 'Recorded (movie header)', value: fmtDate(macTime(created)) });
        if (modified && modified !== created) times.push({ name: 'Modified (movie header)', value: fmtDate(macTime(modified)) });
      } else if (created && !times.some((t) => t.value === fmtDate(macTime(created)))) times.push({ name: `Created (${x.type === 'tkhd' ? 'track' : 'media'})`, value: fmtDate(macTime(created)) });
    } else if (kind === 'udta-item') {
      if (x.type === 'loci') { // 3GPP location
        let o = x.data + 6; while (o < x.end && b[o] !== 0) o++; o += 2;
        if (o + 12 <= x.end) {
          const lon = dv.getInt32(o) / 65536, lat = dv.getInt32(o + 4) / 65536, alt = dv.getInt32(o + 8) / 65536;
          place.push({ name: 'Location (3GPP loci)', value: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
          if (!r.gps && (lat || lon)) r.gps = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), alt: +alt.toFixed(1) };
        }
      } else if (x.type.charCodeAt(0) === 0xa9 || x.type === 'cprt') {
        // QuickTime string item: [len u16][lang u16][string] (may repeat for other languages)
        const len = dv.getUint16(x.data);
        const val = utf8.decode(b.subarray(x.data + 4, Math.min(x.end, x.data + 4 + len))).replace(/\0/g, '').trim();
        const name = QT_NAMES[x.type] || `Tag ${x.type}`;
        if (x.type === '©xyz') { place.push({ name, value: val }); r.gps ||= parseISO6709(val); }
        else (/Make|Model|Software|Encoder/.test(name) ? device : /Date/.test(name) ? times : text).push({ name, value: val });
      } else if (!['free', 'skip', 'Xtra', 'hinf', 'hnti', 'name'].includes(x.type)) text.push({ name: `Box ${x.type}`, value: `${x.end - x.start} bytes` });
    } else if (kind === 'meta') {
      const cs = metaChildStart(b, x);
      let keys = null;
      for (const c of boxes(b, cs, x.end)) {
        if (c.type === 'keys') {
          keys = [null];
          const n = dv.getUint32(c.data + 4); let o = c.data + 8;
          for (let i = 0; i < n && o + 8 <= c.end; i++) { const sz = dv.getUint32(o); keys.push(latin1.decode(b.subarray(o + 8, o + sz))); o += sz; }
        }
        if (c.type === 'ilst') for (const item of boxes(b, c.data, c.end)) {
          const idx = dv.getUint32(item.start + 4);
          const key = keys && idx < keys.length ? keys[idx] : item.type;
          for (const d of boxes(b, item.data, item.end)) {
            if (d.type !== 'data') continue;
            const t = dv.getUint32(d.data) & 0xffffff;
            const raw = b.subarray(d.data + 8, d.end);
            let val = t === 1 ? utf8.decode(raw) : t === 23 && raw.length === 4 ? String(+dv.getFloat32(d.data + 8).toFixed(3)) : t === 21 || t === 22 ? String(raw.reduce((a, v) => a * 256 + v, 0)) : `${raw.length} bytes`;
            val = val.replace(/\0/g, '').trim();
            const name = MDTA_NAMES[key] || QT_NAMES[key] || key.replace(/^com\.(apple\.quicktime|android)\./, '');
            if (/location\.ISO6709|©xyz/.test(key)) { place.push({ name, value: val }); r.gps ||= parseISO6709(val); }
            else if (/accuracy/.test(key)) place.push({ name, value: val });
            else (/Make|Model|Software|Lens|Encoder|Android/.test(name) ? device : /date/i.test(name) ? times : text).push({ name, value: val });
          }
        }
      }
    } else if (kind === 'xmp') {
      r.xmpRaw = utf8.decode(b.subarray(x.data + 16, x.end));
    }
  });
  if (duration != null) r.duration = duration;
  if (place.length) r.groups.push({ name: 'Location', entries: place });
  if (device.length) r.groups.push({ name: 'Device & software', entries: device });
  if (times.length) r.groups.push({ name: 'Timestamps', entries: times });
  if (text.length) r.groups.push({ name: 'Titles & other tags', entries: text });
  r.strip = 'lossless';
  r.notes.push({ level: 'low', text: 'Video cleaning works in place: metadata boxes are blanked and dates zeroed. The picture and sound are not re-encoded.' });
  return r;
}

export function stripVideo(b) {
  const out = b.slice();
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const blank = (x) => { out.fill(0, x.data, x.end); out.set([0x66, 0x72, 0x65, 0x65], x.start + 4); }; // -> 'free'
  scan(b, (kind, x) => {
    if (kind === 'meta' || kind === 'xmp') blank(x);
    else if (kind === 'udta-item' && !['free', 'skip'].includes(x.type)) blank(x);
    else if (kind === 'time') {
      const v = out[x.data], o = x.data + 4;
      if (v === 1) { dv.setBigUint64(o, 0n); dv.setBigUint64(o + 8, 0n); } else { dv.setUint32(o, 0); dv.setUint32(o + 4, 0); }
    }
  });
  return out;
}
