import { analyze, strip, CATEGORY_INFO } from './parsers.js';
import { strangerSummary } from './summary.js';
import { writeZip } from './zip.js';

// ---------------------------------------------------------------- tiny DOM helper (always textContent: metadata is untrusted input)
const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
function toast(msg, ms = 3500) {
  const wrap = $('toasts');
  while (wrap.children.length >= 3) wrap.firstChild.remove();
  const t = h('div', { class: 'toast' }, msg); wrap.append(t);
  setTimeout(() => t.remove(), ms);
}
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const DOC = { docx: ['DOCX', 'Word document'], xlsx: ['XLSX', 'Excel workbook'], pptx: ['PPTX', 'PowerPoint deck'], pdf: ['PDF', 'PDF document'], zip: ['ZIP', 'ZIP archive'] };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heif: 'image/heic', avif: 'image/avif', isobmff: 'image/heif', pdf: 'application/pdf', mov: 'video/quicktime', mp4: 'video/mp4',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

// ---------------------------------------------------------------- state
const state = { items: [], selected: -1 };
const opts = () => ({ keepOrientation: $('opt-orient').checked, keepICC: $('opt-icc').checked, anonymize: $('opt-anon').checked });
const optKey = () => JSON.stringify(opts());

// ---------------------------------------------------------------- intake
async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const first = state.items.length;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let report;
    try { report = await analyze(bytes); }
    catch (err) { console.error(err); report = { format: 'error', groups: [], notes: [{ level: 'high', text: `Could not read this file: ${err.message}` }], counts: {}, total: 0, strip: 'none', segments: [] }; }
    const item = { file, bytes, report, url: URL.createObjectURL(file), thumbUrl: null, summary: strangerSummary(report), clean: null };
    if (report.thumbnail) item.thumbUrl = URL.createObjectURL(new Blob([report.thumbnail], { type: report.thumbnailType || 'image/jpeg' }));
    state.items.push(item);
  }
  $('drop').classList.add('compact');
  $('workspace').classList.remove('hidden');
  renderList(); renderBatchNote();
  select(first);
}
const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('add-more').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
for (const ev of ['dragenter', 'dragover']) window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); });
window.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
window.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) addFiles(f); });
for (const id of ['opt-orient', 'opt-icc', 'opt-anon']) $(id).addEventListener('change', () => { for (const it of state.items) it.clean = null; if (state.selected >= 0) renderCompare(state.items[state.selected]); });

// ---------------------------------------------------------------- risk + list
function riskLevel(it) {
  if (it.summary.some((s) => s.level === 'high')) return 'high';
  if (it.summary.length || it.report.total) return 'med';
  return 'ok';
}
function renderList() {
  $('file-list').replaceChildren(...state.items.map((it, i) => h('li', { class: i === state.selected ? 'sel' : '', onclick: () => select(i) },
    h('span', { class: `dot ${riskLevel(it)}` }),
    h('span', { class: 'fname' }, it.file.name),
    h('span', { class: 'muted small' }, it.clean?.ok ? 'Clean' : it.report.total ? `${it.report.total}` : 'OK'))));
}
function renderBatchNote() {
  const n = state.items.filter((it) => it.report.strip === 'lossless').length, skip = state.items.length - n;
  $('batch-note').textContent = state.items.length ? `${n} file${n === 1 ? '' : 's'} can be cleaned${skip ? ` · ${skip} can only be inspected` : ''}.` : '';
}

// ---------------------------------------------------------------- cleaning (with verification)
// High-risk categories must be gone after cleaning; harmless leftovers (rotation, color profile, app name) are fine.
async function cleanItem(it) {
  if (it.clean && it.clean.key === optKey()) return it.clean;
  const out = await strip(it.bytes, it.report.format, opts());
  const check = await analyze(out);
  const left = check.groups.flatMap((g) => g.entries);
  const bad = left.filter((e) => (e.category === 'location' || e.category === 'identity') && !/^author$|^a$/i.test(String(e.value).trim()));
  const ok = !bad.length && !check.gps && !check.hiddenBytes;
  const before = it.report.groups.flatMap((g) => g.entries.map((e) => ({ ...e })));
  const leftKeys = new Set(left.map((e) => `${e.name}=${e.value}`));
  const removed = before.filter((e) => !leftKeys.has(`${e.name}=${e.value}`));
  it.clean = { key: optKey(), bytes: out, report: check, ok, bad, removed, kept: left, summary: strangerSummary(check) };
  return it.clean;
}

// ---------------------------------------------------------------- detail view
function select(i) {
  state.selected = i;
  renderList();
  const it = state.items[i];
  if (!it) return;
  const r = it.report;

  // preview: image, video or document tile
  const img = $('preview'), vid = $('vpreview'), none = $('no-preview');
  img.classList.add('hidden'); vid.classList.add('hidden'); none.classList.add('hidden');
  vid.removeAttribute('src');
  if (r.isVideo) { vid.src = it.url; vid.classList.remove('hidden'); vid.onerror = () => { vid.classList.add('hidden'); showTile(); }; }
  else if (DOC[r.format]) showTile();
  else { img.classList.remove('hidden'); img.onerror = () => { img.classList.add('hidden'); showTile(); }; img.src = it.url; }
  function showTile() {
    const [kind, label] = DOC[r.format] || (r.isVideo ? ['VIDEO', 'Video'] : ['IMAGE', r.format === 'heif' ? 'HEIC photo (preview needs Safari)' : 'No preview']);
    none.replaceChildren(h('div', { class: 'doc-tile' }, h('span', { class: 'doc-tile-kind' }, kind), h('small', {}, label)));
    none.classList.remove('hidden');
  }

  $('d-name').textContent = it.file.name;
  const bits = [r.isVideo ? (r.format === 'mov' ? 'MOV video' : 'MP4 video') : DOC[r.format]?.[1] || r.format.toUpperCase(), fmtBytes(it.file.size)];
  if (r.width) bits.push(`${r.width}×${r.height}`);
  if (r.duration) bits.push(`${r.duration.toFixed(1)} s`);
  $('d-sub').textContent = bits.join(' · ');

  const lvl = riskLevel(it), verdict = $('verdict');
  verdict.className = `verdict ${lvl}`;
  verdict.textContent = lvl === 'high' ? `This file gives away personal details (${r.total} metadata fields).`
    : lvl === 'med' ? `This file has ${r.total} metadata fields, mostly device or time details.`
    : r.total ? `Only technical metadata found (${r.total} fields).` : 'No metadata found in this file.';

  const chips = Object.entries(CATEGORY_INFO).filter(([k]) => r.counts?.[k]).map(([k, c]) =>
    h('a', { class: `chip ${c.risk}`, href: `#cat-${k}`, title: c.why }, `${c.label} `, h('b', {}, r.counts[k])));
  if (r.thumbnail) chips.push(h('a', { class: 'chip high', href: '#thumb-card' }, 'Hidden thumbnail'));
  if (r.hiddenBytes) chips.push(h('span', { class: 'chip high' }, `${fmtBytes(r.hiddenBytes)} hidden data`));
  $('chips').replaceChildren(...chips);

  const lossless = r.strip === 'lossless';
  $('dl-clean').classList.toggle('hidden', !lossless);
  const canReencode = r.strip === 'reencode' || (/^(jpeg|png|webp|gif|heif|avif)$/.test(r.format) && !lossless);
  $('dl-reencode').classList.toggle('hidden', !canReencode);
  $('strip-note').textContent = lossless ? 'Lossless: metadata is removed or blanked in place, content untouched. Every clean copy is re-checked before download.'
    : canReencode ? 'Re-encoding redraws the image to a fresh file. All metadata is gone, with a slight quality change.'
    : 'This format can be inspected but not cleaned in the browser.';

  renderStranger(it.summary, $('stranger'), 'What a stranger could learn from this file');
  $('notes').replaceChildren(...r.notes.map((n) => h('div', { class: `note ${n.level}` }, n.text)));

  const gpsCard = $('gps-card');
  if (r.gps) {
    gpsCard.classList.remove('hidden');
    $('gps-title').textContent = DOC[r.format] ? 'A photo inside reveals where it was taken' : r.isVideo ? 'This video reveals where it was recorded' : 'This photo reveals where it was taken';
    const { lat, lon, alt } = r.gps;
    $('gps-coords').replaceChildren(
      h('div', {}, h('span', { class: 'muted' }, 'Latitude  '), `${lat}`),
      h('div', {}, h('span', { class: 'muted' }, 'Longitude '), `${lon}`),
      alt != null ? h('div', {}, h('span', { class: 'muted' }, 'Altitude  '), `${alt} m`) : '');
    $('gps-osm').href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    $('gps-gmaps').href = `https://www.google.com/maps?q=${lat},${lon}`;
    $('gps-copy').onclick = () => navigator.clipboard?.writeText(`${lat}, ${lon}`).then(() => toast('Coordinates copied'));
    drawMiniMap($('mini-map'), lat, lon);
  } else gpsCard.classList.add('hidden');

  $('thumb-card').classList.toggle('hidden', !it.thumbUrl || r.thumbnail.length < 400);
  if (it.thumbUrl) {
    $('thumb').src = it.thumbUrl;
    $('thumb-note').textContent = DOC[r.format] ? 'Office apps save a small picture of the first page inside the file.' : "Cameras embed a small preview inside the file. Editors often don't update it, so it can show the photo before cropping or blurring.";
  }

  const seenCat = new Set();
  $('groups').replaceChildren(...r.groups.map((g) => {
    const rows = g.entries.map((e) => {
      const info = CATEGORY_INFO[e.category] || CATEGORY_INFO.technical;
      const anchor = !seenCat.has(e.category) ? (seenCat.add(e.category), `cat-${e.category}`) : null;
      return h('tr', { id: anchor }, h('td', { class: 'k' }, h('span', { class: `tag ${info.risk}`, title: info.label }, info.tag), ' ', e.name), h('td', { class: 'v' }, String(e.value)));
    });
    return h('details', { class: 'panel card group', open: '' }, h('summary', {}, g.name, h('span', { class: 'muted small' }, `  ${g.entries.length} fields`)),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, rows))));
  }));
  $('xmp-raw-wrap').classList.toggle('hidden', !r.xmpRaw);
  $('xmp-raw').textContent = r.xmpRaw || '';
  $('structure').replaceChildren(...(r.segments || []).slice(0, 200).map((s) => h('div', { class: 'seg' }, h('span', {}, s.marker), h('span', { class: 'muted' }, fmtBytes(s.size)))),
    r.segments?.length ? '' : h('div', { class: 'muted' }, 'Not shown for this format'));

  renderCompare(it);
}

function renderStranger(list, el, title, clean = false) {
  el.replaceChildren(h('h3', {}, title),
    list.length ? h('ul', { class: `learn${clean ? ' clean' : ''}` }, ...list.map((s) => h('li', { class: s.level }, h('span', { class: 'label' }, s.label), h('span', {}, s.text))))
      : h('p', { class: 'muted' }, clean ? 'Nothing personal: just the content itself.' : 'Nothing personal. This file looks clean.'));
}

// before / after
async function renderCompare(it) {
  const box = $('compare');
  if (it.report.strip !== 'lossless') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.replaceChildren(h('h3', {}, 'Before → after cleaning'), h('p', { class: 'muted' }, 'Working out what will change…'));
  const c = await cleanItem(it).catch((e) => ({ error: e }));
  if (state.items[state.selected] !== it) return;
  if (c.error) { box.replaceChildren(h('h3', {}, 'Before → after cleaning'), h('div', { class: 'note high' }, `Could not clean this file: ${c.error.message}`)); return; }
  const byCat = {};
  for (const e of c.removed) (byCat[e.category] ||= []).push(e);
  const order = ['location', 'identity', 'device', 'time', 'content', 'technical'];
  box.replaceChildren(
    h('h3', {}, 'Before → after cleaning'),
    h('div', { class: 'cols' },
      h('div', { class: 'side' }, h('span', { class: 'muted small' }, 'Before'), h('b', {}, `${it.report.total} fields`), h('span', { class: 'muted small' }, fmtBytes(it.bytes.length))),
      h('div', { class: 'arrow' }, '→'),
      h('div', { class: 'side after' }, h('span', { class: 'muted small' }, 'After'), h('b', {}, `${c.kept.length} field${c.kept.length === 1 ? '' : 's'}`), h('span', { class: 'muted small' }, `${fmtBytes(c.bytes.length)}${c.bytes.length === it.bytes.length ? ' (same size, blanked in place)' : ''}`))),
    c.removed.length ? h('p', { class: 'small' }, h('b', {}, `Removed (${c.removed.length})`)) : '',
    ...order.filter((k) => byCat[k]).map((k) => h('div', { class: 'removed', title: CATEGORY_INFO[k].label }, ...byCat[k].slice(0, 30).map((e) => h('span', {}, `${e.name}: ${String(e.value).slice(0, 40)}`)))),
    c.kept.length ? h('p', { class: 'small' }, h('b', {}, 'Kept on purpose'), h('span', { class: 'muted' }, ' (harmless, or needed to display correctly)')) : '',
    c.kept.length ? h('div', { class: 'kept' }, ...c.kept.map((e) => h('span', {}, `${e.name}: ${String(e.value).slice(0, 40)}`))) : '',
    (() => { const d = h('div'); renderStranger(c.summary, d, 'After cleaning, a stranger could learn', true); return d; })(),
    c.ok ? '' : h('div', { class: 'note high' }, `Some sensitive fields could not be removed: ${c.bad.map((e) => e.name).join(', ')}. Download is blocked for safety.`));
  renderList();
}

function drawMiniMap(el, lat, lon) {
  const W = 220, H = 110, c = h('canvas', { width: W * 2, height: H * 2 });
  c.style.width = `${W}px`; c.style.height = `${H}px`;
  const g = c.getContext('2d'); g.scale(2, 2);
  g.fillStyle = '#0d1620'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1f3142'; g.lineWidth = 1;
  for (let x = 0; x <= 360; x += 30) { const px = (x / 360) * W; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }
  for (let y = 0; y <= 180; y += 30) { const py = (y / 180) * H; g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); }
  const px = ((lon + 180) / 360) * W, py = ((90 - lat) / 180) * H;
  g.strokeStyle = 'rgba(248,113,113,.5)'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.moveTo(0, py); g.lineTo(W, py); g.stroke();
  g.fillStyle = 'rgba(248,113,113,.25)'; g.beginPath(); g.arc(px, py, 9, 0, 7); g.fill();
  g.fillStyle = '#f87171'; g.beginPath(); g.arc(px, py, 3.5, 0, 7); g.fill();
  el.replaceChildren(c);
}

// ---------------------------------------------------------------- outputs
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const cleanName = (name, ext) => `${name.replace(/\.[^.]+$/, '')}_clean.${ext || name.split('.').pop()}`;

$('dl-clean').addEventListener('click', async () => {
  const it = state.items[state.selected];
  try {
    const c = await cleanItem(it);
    if (!c.ok) throw new Error('Verification failed, so the file was not saved');
    download(new Blob([c.bytes], { type: MIME[it.report.format] || 'application/octet-stream' }), cleanName(it.file.name));
    const saved = it.bytes.length - c.bytes.length;
    toast(`Verified clean · ${c.removed.length} fields removed${saved > 0 ? ` · ${fmtBytes(saved)} smaller` : ''}`);
  } catch (e) { toast(`Error: ${e.message}`); }
});

$('dl-reencode').addEventListener('click', async () => {
  const it = state.items[state.selected];
  try {
    const bmp = await createImageBitmap(it.file, { imageOrientation: 'from-image' });
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const type = /png|gif/.test(it.report.format) ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, type, 0.95));
    download(blob, cleanName(it.file.name, type === 'image/png' ? 'png' : 'jpg'));
    toast('Re-encoded copy saved (all metadata removed)');
  } catch { toast('Your browser cannot open this image format'); }
});

$('dl-report').addEventListener('click', () => {
  const it = state.items[state.selected], r = it.report;
  const report = {
    file: it.file.name, size: it.file.size, format: r.format, width: r.width, height: r.height, duration: r.duration,
    whatAStrangerCouldLearn: it.summary.map((s) => s.text), gps: r.gps, hiddenBytes: r.hiddenBytes, hasThumbnail: !!r.thumbnail,
    notes: r.notes.map((n) => n.text),
    groups: r.groups.map((g) => ({ name: g.name, fields: Object.fromEntries(g.entries.map((e) => [e.name, String(e.value)])) })),
    generatedBy: 'MetaScrub', generatedAt: new Date().toISOString(),
  };
  download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${it.file.name}.metadata.json`);
});

// batch: one zip with every cleaned file
$('strip-all').addEventListener('click', async () => {
  const btn = $('strip-all'); btn.disabled = true;
  const files = [], skipped = [], used = new Set();
  try {
    for (const [i, it] of state.items.entries()) {
      btn.textContent = `Cleaning ${i + 1} of ${state.items.length}…`;
      if (it.report.strip !== 'lossless') { skipped.push(it.file.name); continue; }
      try {
        const c = await cleanItem(it);
        if (!c.ok) { skipped.push(it.file.name); continue; }
        let name = cleanName(it.file.name), n = 2;
        while (used.has(name)) name = cleanName(it.file.name.replace(/(\.[^.]+)$/, `_${n++}$1`));
        used.add(name);
        files.push({ name, data: c.bytes, store: true });
      } catch { skipped.push(it.file.name); }
    }
    if (!files.length) { toast('Nothing could be cleaned in this batch.'); return; }
    if (files.length === 1) { const f = files[0]; download(new Blob([f.data]), f.name); }
    else download(new Blob([await writeZip(files)], { type: 'application/zip' }), 'metascrub-clean.zip');
    renderList();
    toast(`${files.length} verified clean file${files.length === 1 ? '' : 's'}${files.length > 1 ? ' in one zip' : ''}${skipped.length ? ` · ${skipped.length} skipped (inspect only)` : ''}`, 5000);
  } finally { btn.disabled = false; btn.textContent = 'Clean all → one .zip'; }
});

$('clear-all').addEventListener('click', () => {
  for (const it of state.items) { URL.revokeObjectURL(it.url); if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); }
  state.items = []; state.selected = -1;
  $('workspace').classList.add('hidden');
  $('drop').classList.remove('compact');
});
