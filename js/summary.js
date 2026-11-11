// "What could a stranger learn?" Turns raw metadata into a few plain-English sentences.
// Input: a report from analyze(). Output: [{ label, level: 'high'|'med'|'low', text }]

const all = (r) => r.groups.flatMap((g) => g.entries.map((e) => ({ ...e, group: g.name })));
function pick(r, ...patterns) {
  const es = all(r);
  for (const p of patterns) {
    const hit = es.find((e) => (p instanceof RegExp ? p.test(e.name) : e.name.toLowerCase() === p.toLowerCase()) && String(e.value).trim());
    if (hit) return String(hit.value).trim();
  }
  return null;
}
const picks = (r, re) => [...new Set(all(r).filter((e) => re.test(e.name) && String(e.value).trim()).map((e) => String(e.value).trim()))];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Parse "2026:11:02 09:14:55", ISO strings, PDF "D:20261007120000-05'00'", or "2026-11-02 14:14:55 UTC"
export function parseWhen(s, offset) {
  if (!s) return null;
  let m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2}| UTC)?/.exec(s);
  if (!m) { const p = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(s); if (p) m = [null, p[1], p[2], p[3], p[4] || '00', p[5] || '00', p[6] || '00', p[7] ? p[7].replace(/'/g, '') : null]; }
  if (!m) return null;
  const [, Y, Mo, D, h, mi] = m;
  let tz = m[7] || offset || null;
  if (tz === ' UTC' || tz === 'Z') tz = 'UTC';
  if (+Y < 1980) return null;
  // the local wall-clock time as written (no conversion), plus the stated offset if any
  const d = new Date(Date.UTC(+Y, +Mo - 1, +D, +h, +mi));
  if (isNaN(d)) return null;
  const hr = +h, ampm = hr < 12 ? 'AM' : 'PM', h12 = hr % 12 || 12;
  const part = hr < 5 ? 'in the middle of the night' : hr < 12 ? 'in the morning' : hr < 17 ? 'in the afternoon' : hr < 21 ? 'in the evening' : 'at night';
  const tzText = tz ? (tz === 'UTC' ? ' UTC' : ` (UTC${tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')})`) : '';
  return { text: `${DAYS[d.getUTCDay()]}, ${MONTHS[+Mo - 1]} ${+D}, ${Y} at ${h12}:${mi} ${ampm}${tzText}`, part, date: d };
}

export function strangerSummary(r) {
  const out = [];
  const add = (label, level, text) => out.push({ label, level, text });
  const isDoc = /docx|xlsx|pptx|pdf/.test(r.format), isVid = !!r.isVideo;
  const noun = isVid ? 'video' : isDoc ? (r.docType || 'document').toLowerCase() : 'photo';

  // where
  if (r.gps) {
    const acc = pick(r, /accuracy/i);
    const where = `${r.gps.lat.toFixed(5)}, ${r.gps.lon.toFixed(5)}${acc ? ` (within about ${Math.round(+acc)} m)` : ''}`;
    add('Location', 'high', isDoc ? `A photo inside this ${noun} reveals exactly where it was taken: ${where}. That's precise enough to pick out a house or building.`
      : `Exactly where this ${noun} was taken: ${where}. That's precise enough to pick out a house or building.`);
  } else {
    const place = [pick(r, /city$/i), pick(r, /province|state$/i), pick(r, /country/i)].filter(Boolean);
    if (place.length) add('Location', 'high', `Tagged with a place: ${place.join(', ')}.`);
  }

  // when
  const offset = pick(r, 'OffsetTimeOriginal', 'OffsetTime');
  const whenRaw = pick(r, 'DateTimeOriginal', 'Creation date', 'Recorded (movie header)', 'Created', 'CreationDate', 'xmp:CreateDate', 'DateTime', 'DateCreated', 'Date');
  const when = parseWhen(whenRaw, offset);
  if (when) add('Date', 'med', isDoc ? `Created ${when.text}.` : `${isVid ? 'Recorded' : 'Taken'} ${when.text}: ${when.part}.`);
  if (isDoc) {
    const saved = parseWhen(pick(r, 'Last saved', 'ModDate'));
    if (saved && (!when || saved.date - when.date > 60000)) add('Date', 'med', `Last saved ${saved.text}.`);
    const edit = pick(r, 'Total editing time'); if (edit && edit !== '0 min') add('Editing', 'low', `Someone spent ${edit} editing it.`);
    const rev = pick(r, 'Revision number'); if (rev && +rev > 1) add('History', 'low', `It has been saved ${rev} times.`);
  }

  // who
  const names = new Set([...picks(r, /^(Author|Artist|XPAuthor|By-line|CameraOwnerName|dc:creator|Copyright|CopyrightNotice|Last modified by|.*comment author|.*tracked change author|Comment author|Tracked change author|Manager)$/i)]);
  for (const n of [...names]) if (/^(author|a|unknown|\s*)$/i.test(n)) names.delete(n);
  const company = pick(r, 'Company');
  if (names.size) add('Identity', 'high', `Names inside: ${[...names].slice(0, 5).join(', ')}${names.size > 5 ? ` and ${names.size - 5} more` : ''}.`);
  if (company) add('Organization', 'high', `Organization: ${company}.`);
  const tpl = pick(r, 'Template');
  const user = /\\Users\\([^\\]+)|\/Users\/([^/]+)|\/home\/([^/]+)/.exec(tpl || '');
  if (user) add('Computer', 'high', `The template path reveals a computer username: "${user[1] || user[2] || user[3]}".`);
  const serial = pick(r, 'BodySerialNumber', 'LensSerialNumber', 'Content identifier (links Live Photo pairs)', 'ImageUniqueID');
  if (serial) add('ID', 'high', 'A unique serial number or ID that can link this file to others from the same device.');

  // device
  const make = pick(r, 'Make'), model = pick(r, 'Model'), sw = pick(r, 'Software');
  if (make || model) {
    let dev = [make, model && make && model.toLowerCase().startsWith(make.toLowerCase()) ? model.slice(make.length).trim() : model].filter(Boolean).join(' ');
    if (/apple/i.test(make || '') && /^\d+(\.\d+)*$/.test(sw || '')) dev += ` running iOS ${sw}`;
    else if (sw && !/^(lavf|ffmpeg)/i.test(sw)) dev += ` (${sw})`;
    const article = /^[aeiou]/i.test(dev) ? 'an' : 'a';
    add('Device', 'med', isDoc ? `Contains a photo shot on ${article} ${dev}.` : `${isVid ? 'Filmed' : 'Shot'} on ${article} ${dev}.`);
    const lens = pick(r, 'LensModel', 'Lens model'); if (lens) add('Lens', 'low', `Lens: ${lens}.`);
  }
  const tool = pick(r, 'xmp:CreatorTool', 'Creator', 'Application', 'OriginatingProgram');
  if (tool && !/^\d+(\.\d+)*$/.test(tool) && !(make && tool.includes(make))) add('Software', 'low', `${isDoc ? 'Made with' : 'Edited with'} ${tool}.`);

  // content & hidden stuff
  const caption = pick(r, 'ImageDescription', 'Caption-Abstract', 'Title', 'Subject', 'Comments', 'dc:description', 'Keywords');
  if (caption) add('Hidden text', 'med', `Hidden text: "${caption.slice(0, 80)}${caption.length > 80 ? '…' : ''}"`);
  if (r.thumbnail && r.thumbnail.length > 400) add('Preview', 'med', isDoc ? 'A thumbnail picture of the first page is stored inside.' : 'A hidden preview image is stored inside; it can show the picture before cropping or edits.');
  if (r.hiddenBytes) add('Hidden data', 'high', 'Extra data is hidden after the end of the image (often a second photo or a depth map).');
  if (r.officeStats?.tracked) add('History', 'high', `${r.officeStats.tracked} tracked change${r.officeStats.tracked > 1 ? 's' : ''}: earlier wording and deleted text may still be readable.`);
  if (r.notes.some((n) => /incremental updates/.test(n.text))) add('History', 'med', 'Older saved versions are layered inside this PDF.');
  if (r.notes.some((n) => /portrait matte/.test(n.text))) add('Mask', 'low', 'A cut-out mask of the people in the photo is stored as an extra layer.');
  if (isVid && r.duration) add('Duration', 'low', `It's ${r.duration < 60 ? `${Math.round(r.duration)} second${Math.round(r.duration) === 1 ? '' : 's'}` : `${Math.floor(r.duration / 60)} min ${Math.round(r.duration % 60)} s`} long.`);
  return out;
}
