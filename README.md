# MetaScrub

**See what your photos, videos and documents secretly reveal, then remove it. Everything happens in your browser; nothing is uploaded.**

MetaScrub reads the hidden metadata in a file, explains it in plain English ("Taken Monday at 9:14 AM at these coordinates on an iPhone 16 Pro"), and makes a clean copy without re-compressing anything.

## What it handles

| Type | Reads | Cleans |
|---|---|---|
| Photos: JPEG, PNG, WebP | EXIF, GPS, XMP, IPTC, comments, embedded thumbnails, data hidden after the image | Lossless |
| iPhone HEIC / HEIF / AVIF | EXIF, GPS, XMP, thumbnail, depth & portrait layers | In place |
| Videos: iPhone MOV, Android MP4 | GPS, phone model, software, recording dates | In place |
| Word, Excel, PowerPoint | Author, last editor, company, manager, template path, editing time, comment & tracked-change authors, photos inside (with their GPS) | Supported |
| PDF | Author, title, dates, producer, XMP, every saved revision | In place |
| TIFF | EXIF, GPS | view only |

Features:
- **"What a stranger could learn"**: plain-English findings for every file, before and after cleaning.
- **Before/after view**: every removed field listed, plus what's kept on purpose (rotation, color profile).
- **Verified downloads**: each clean copy is re-checked, and the download is blocked if anything sensitive survives.
- **Batch mode**: clean everything into one `.zip`.

## Privacy

The page ships with a Content-Security-Policy that blocks all network requests (`connect-src 'none'`), so it *can't* send your files anywhere. The map buttons are ordinary links that you choose to open.

## Run locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```
(ES modules don't load from `file://`.)

## Publish to GitHub Pages

```bash
scripts/publish.sh            # creates github.com/<you>/metascrub, pushes, enables Pages
```
Needs the [GitHub CLI](https://cli.github.com) (`gh auth login` once). The site appears at `https://<you>.github.io/metascrub/`.

## Tests

```bash
npm test
```
Test fixtures (photos, iPhone-style HEIC, videos, Word/Excel/PowerPoint/PDF) are generated on the fly with Python (Pillow, python-docx, openpyxl, python-pptx, reportlab, pypdf) and ffmpeg; missing tools just skip those checks. GitHub Actions runs the full suite on every push.

## Layout

```
index.html          the app (single page)
css/                base theme + MetaScrub styles
js/
  app.js            UI
  parsers.js        format detection, analyze(), strip(); JPEG/PNG/WebP/HEIC/TIFF/PDF
  video.js          MOV/MP4 metadata
  office.js         docx/xlsx/pptx
  zip.js            tiny ZIP reader/writer
  summary.js        plain-English findings
  tags.js           EXIF/GPS/IPTC dictionaries
tests/              test suite + fixture generators
scripts/publish.sh  one-time GitHub repo + Pages setup
```
