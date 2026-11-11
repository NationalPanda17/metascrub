// Word / Excel / PowerPoint (.docx .xlsx .pptx): ZIP packages of XML parts.
// Personal info lives in: docProps/core.xml (author, last modified by, dates, revision), docProps/app.xml
// (company, manager, template path, total editing time), docProps/custom.xml, comment & tracked-change
// authors inside the content parts, people/persons lists, a thumbnail of page 1, and embedded photos
// (which carry their own EXIF/GPS). Cleaning rewrites only those parts; the document content is untouched.
import { readZip, writeZip, isZip } from './zip.js';

const td = new TextDecoder('utf-8'), te = new TextEncoder();
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const CORE = {
  'dc:creator': 'Author', 'cp:lastModifiedBy': 'Last modified by', 'dcterms:created': 'Created', 'dcterms:modified': 'Last saved',
  'cp:lastPrinted': 'Last printed', 'cp:revision': 'Revision number', 'dc:title': 'Title', 'dc:subject': 'Subject',
  'cp:keywords': 'Keywords', 'dc:description': 'Comments', 'cp:category': 'Category', 'cp:contentStatus': 'Status',
  'dc:language': 'Language', 'cp:version': 'Version', 'dc:identifier': 'Identifier',
};
const APP = { Company: 'Company', Manager: 'Manager', Template: 'Template', TotalTime: 'Total editing time', HyperlinkBase: 'Hyperlink base', Application: 'Application', AppVersion: 'App version' };
const APP_REMOVE = ['Company', 'Manager', 'Template', 'TotalTime', 'HyperlinkBase'];
const KINDS = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' };
const NAME = { docx: 'Word document', xlsx: 'Excel workbook', pptx: 'PowerPoint deck' };
// blank 8×8 white images used to replace the first-page thumbnail (keeps the package structure valid)
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const BLANK = { jpeg: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==', png: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAF0lEQVR4XmP8//8/AzbAhFWUgWGQSgAAVtQDDc7bz2EAAAAASUVORK5CYII=' };

export function officeKind(b) {
  if (!isZip(b)) return null;
  try { const names = new Set(readZip(b).map((e) => e.name)); return Object.keys(KINDS).find((k) => names.has(KINDS[k])) || null; } catch { return null; }
}

const tagText = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? unescape(m[1].replace(/<[^>]+>/g, '')).trim() : ''; };
const attrValues = (xml, attr) => [...xml.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, 'g'))].map((m) => unescape(m[1]));

export async function parseOffice(b, base, kind, { analyzeImage } = {}) {
  const r = base;
  r.format = kind; r.docType = NAME[kind];
  const entries = readZip(b);
  const get = async (name) => { const e = entries.find((x) => x.name === name); return e ? td.decode(await e.read()) : null; };
  const props = [], app = [], custom = [], people = new Map();
  const core = await get('docProps/core.xml');
  if (core) for (const [tag, label] of Object.entries(CORE)) { const v = tagText(core, tag); if (v) props.push({ name: label, value: v }); }
  const appXml = await get('docProps/app.xml');
  if (appXml) for (const [tag, label] of Object.entries(APP)) {
    let v = tagText(appXml, tag);
    if (!v) continue;
    if (tag === 'TotalTime') { const m = +v; v = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; }
    app.push({ name: label, value: v });
  }
  const customXml = await get('docProps/custom.xml');
  if (customXml) for (const m of customXml.matchAll(/<property[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)) custom.push({ name: unescape(m[1]), value: unescape(m[2].replace(/<[^>]+>/g, '')).trim() });

  // comment & tracked-change authors, people lists
  let comments = 0, tracked = 0, rsids = 0;
  const addPerson = (n, why) => { n = n.trim(); if (!n) return; const p = people.get(n) || new Set(); p.add(why); people.set(n, p); };
  for (const e of entries) {
    if (!/\.xml$/.test(e.name) || e.name.startsWith('docProps/')) continue;
    if (!/^(word|xl|ppt)\//.test(e.name)) continue;
    const xml = td.decode(await e.read());
    if (/comments/i.test(e.name)) { comments += (xml.match(/<w:comment\s|<comment\s|<p:cm\s|<threadedComment\s/g) || []).length; }
    if (e.name === 'word/document.xml') tracked += (xml.match(/<w:(ins|del)\s/g) || []).length;
    if (e.name === 'word/settings.xml') rsids = (xml.match(/<w:rsid\s/g) || []).length;
    for (const a of attrValues(xml, 'w:author')) addPerson(a, /comments/.test(e.name) ? 'comment' : 'tracked change');
    for (const a of attrValues(xml, 'w15:author')) addPerson(a, 'reviewer list');
    for (const m of xml.matchAll(/<author>([^<]*)<\/author>/g)) addPerson(unescape(m[1]), 'comment');
    if (/commentAuthors|persons\/person/.test(e.name)) { for (const a of attrValues(xml, 'name')) addPerson(a, 'comment'); for (const a of attrValues(xml, 'displayName')) addPerson(a, 'comment'); }
  }
  if (props.length) r.groups.push({ name: 'Document properties', entries: props });
  if (app.length) r.groups.push({ name: 'Application & organization', entries: app });
  if (custom.length) r.groups.push({ name: 'Custom properties', entries: custom });
  if (people.size) r.groups.push({ name: 'People named inside', entries: [...people].map(([n, why]) => ({ name: [...why].join(' & ').replace(/^./, (c) => c.toUpperCase()) + ' author', value: n })) });
  r.officeStats = { comments, tracked, rsids };
  if (comments) r.notes.push({ level: 'med', text: `${comments} comment${comments > 1 ? 's' : ''} inside. Cleaning keeps the comments but replaces their authors' names with "Author".` });
  if (tracked) r.notes.push({ level: 'high', text: `${tracked} tracked change${tracked > 1 ? 's' : ''}: deleted text may still be readable. Accept or reject all changes in ${kind === 'docx' ? 'Word' : 'the app'} before sharing; cleaning only anonymizes who made them.` });
  if (rsids) r.notes.push({ level: 'low', text: `${rsids} editing-session IDs (rsids) can link this file to other drafts edited on the same computer.` });
  const thumb = entries.find((e) => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(e.name));
  if (thumb) { r.thumbnail = await thumb.read(); r.thumbnailType = /png$/i.test(thumb.name) ? 'image/png' : 'image/jpeg'; }
  if (entries.some((e) => /printerSettings/i.test(e.name))) r.notes.push({ level: 'low', text: 'Contains saved printer settings, which can include the name of your printer.' });
  // embedded photos carry their own metadata
  const media = entries.filter((e) => /\/media\/[^/]+\.(jpe?g|png|webp|heic)$/i.test(e.name));
  if (media.length && analyzeImage) {
    let risky = 0;
    for (const m of media.slice(0, 40)) {
      const rep = await analyzeImage(await m.read());
      if (rep.gps && !r.gps) r.gps = rep.gps;
      if (rep.counts?.location || rep.counts?.identity || rep.counts?.device) {
        risky++;
        r.groups.push({ name: `Embedded image: ${m.name.split('/').pop()}`, entries: rep.groups.flatMap((g) => g.entries).slice(0, 25).map((x) => ({ name: x.name, value: String(x.value), category: x.category })) });
      }
    }
    if (risky) r.notes.push({ level: 'high', text: `${risky} of ${media.length} embedded image${media.length > 1 ? 's' : ''} carry their own photo metadata (camera, location…). Cleaning strips those too.` });
  }
  r.strip = 'lossless';
  return r;
}

export async function cleanOffice(b, { anonymize = true } = {}, { stripImage, detect } = {}) {
  const entries = readZip(b);
  const files = [];
  for (const e of entries) {
    let data = await e.read();
    const n = e.name;
    if (n === 'docProps/core.xml') {
      data = te.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>');
    } else if (n === 'docProps/app.xml') {
      let xml = td.decode(data);
      for (const t of APP_REMOVE) xml = xml.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?</${t}>|<${t}\\s*/>`, 'g'), '');
      data = te.encode(xml);
    } else if (n === 'docProps/custom.xml') {
      data = te.encode(td.decode(data).replace(/(<Properties\b[^>]*>)[\s\S]*(<\/Properties>)/, '$1$2'));
    } else if (anonymize && /\.xml$/.test(n) && /^(word|xl|ppt)\//.test(n)) {
      let xml = td.decode(data), before = xml;
      xml = xml.replace(/(\sw:author=")[^"]*(")/g, '$1Author$2').replace(/(\sw:initials=")[^"]*(")/g, '$1A$2')
        .replace(/(\sw15:author=")[^"]*(")/g, '$1Author$2').replace(/(\sw15:userId=")[^"]*(")/g, '$1Author$2').replace(/(\sw15:providerId=")[^"]*(")/g, '$1None$2')
        .replace(/<author>[^<]*<\/author>/g, '<author>Author</author>');
      if (/commentAuthors|persons\/person/.test(n)) xml = xml.replace(/(\sname=")[^"]*(")/g, '$1Author$2').replace(/(\sinitials=")[^"]*(")/g, '$1A$2').replace(/(\sdisplayName=")[^"]*(")/g, '$1Author$2').replace(/(\suserId=")[^"]*(")/g, '$1Author$2');
      if (xml !== before) data = te.encode(xml);
    } else if (/^docProps\/thumbnail\.(jpe?g|png)$/i.test(n)) {
      data = b64(/png$/i.test(n) ? BLANK.png : BLANK.jpeg);
    } else if (stripImage && /\/media\/[^/]+\.(jpe?g|png|webp|heic)$/i.test(n)) {
      try { const f = detect(data); if (['jpeg', 'png', 'webp', 'heif'].includes(f)) data = stripImage(data, f); } catch { /* leave image as-is */ }
    }
    files.push({ name: n, data });
  }
  return writeZip(files);
}
