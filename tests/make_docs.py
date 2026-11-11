"""Build Office + PDF fixtures full of personal metadata.
Needs: python-docx, openpyxl, python-pptx, reportlab, pypdf, Pillow.  Usage: python3 tests/make_docs.py OUT_DIR"""
import sys, os, io, zipfile, datetime, re
from PIL import Image
out = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'; os.makedirs(out, exist_ok=True)
when = datetime.datetime(2026, 10, 5, 8, 30)

# a photo with GPS to embed in documents
ex = Image.Exif(); ex[0x010f] = 'Apple'; ex[0x0110] = 'iPhone 15'; g = ex.get_ifd(0x8825); g[1] = 'N'; g[2] = (38.0, 48.0, 15.0); g[3] = 'W'; g[4] = (77.0, 2.0, 49.0)
photo = io.BytesIO(); Image.new('RGB', (120, 80), (90, 140, 200)).save(photo, 'JPEG', exif=ex.tobytes()); photo.seek(0)

def patch(path, fn):
    zin = zipfile.ZipFile(path); items = [(i, zin.read(i.filename)) for i in zin.infolist()]; zin.close()
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, data in items: z.writestr(i, fn(i.filename, data))

# --- Word: author, company, template path, comments + tracked change, embedded GPS photo
from docx import Document
from docx.shared import Inches
d = Document(); cp = d.core_properties
cp.author = 'Jane Doe'; cp.last_modified_by = 'John Smith'; cp.title = 'Q4 reorg plan'; cp.comments = 'Draft - do not share'; cp.keywords = 'confidential'; cp.revision = 14; cp.created = when; cp.modified = when
d.add_paragraph('Hello world. This paragraph is the real content.')
d.add_picture(photo, width=Inches(1))
try:
    para = d.paragraphs[0]; d.add_comment(para.runs, text='Check this number', author='Jane Doe', initials='JD')
except Exception: pass
d.save(f'{out}/report.docx')
def word_fix(name, data):
    if name == 'docProps/app.xml':
        return data.replace(b'</Properties>', b'<Company>Acme Federal LLC</Company><Manager>Pat Lee</Manager><Template>C:\\Users\\jdoe\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm</Template><TotalTime>754</TotalTime></Properties>')
    if name == 'word/document.xml':
        return data.replace(b'<w:p>', b'<w:p><w:ins w:id="99" w:author="John Smith" w:date="2026-10-06T10:00:00Z"><w:r><w:t>Inserted text. </w:t></w:r></w:ins>', 1)
    return data
patch(f'{out}/report.docx', word_fix)

# --- Excel: creator + cell comment author
from openpyxl import Workbook
from openpyxl.comments import Comment
wb = Workbook(); ws = wb.active; ws['A1'] = 'Budget'; ws['B2'] = 42
ws['B2'].comment = Comment('Is this right?', 'Jane Doe')
wb.properties.creator = 'Jane Doe'; wb.properties.lastModifiedBy = 'John Smith'; wb.properties.title = 'FY27 budget'
wb.save(f'{out}/budget.xlsx')

# --- PowerPoint
from pptx import Presentation
pr = Presentation(); s = pr.slides.add_slide(pr.slide_layouts[1]); s.shapes.title.text = 'Hello'
pr.core_properties.author = 'Jane Doe'; pr.core_properties.last_modified_by = 'John Smith'; pr.core_properties.title = 'Kickoff'
pr.save(f'{out}/deck.pptx')

# --- PDF: Info dict + XMP + an incremental update (old author survives in the earlier revision)
from reportlab.pdfgen import canvas
c = canvas.Canvas(f'{out}/memo_base.pdf'); c.setAuthor('Jane Doe'); c.setTitle('Memo'); c.setSubject('Private'); c.setCreator('Microsoft Word for Microsoft 365'); c.setKeywords('budget, layoffs')
c.drawString(72, 720, 'Hello from the memo'); c.save()
from pypdf import PdfReader, PdfWriter
w = PdfWriter(clone_from=f'{out}/memo_base.pdf')
w.add_metadata({'/Author': 'Jane Doe', '/Title': 'Memo', '/Company': 'Acme Federal LLC'})
xmp = b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Microsoft Word"><dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
from pypdf.generic import StreamObject, NameObject
st = StreamObject(); st.set_data(xmp); st.update({NameObject('/Type'): NameObject('/Metadata'), NameObject('/Subtype'): NameObject('/XML')})
w._root_object[NameObject('/Metadata')] = w._add_object(st)
w.write(f'{out}/memo_full.pdf')
w2 = PdfWriter(f'{out}/memo_full.pdf', incremental=True)
w2.add_metadata({'/Author': 'J. Doe (edited)', '/ModDate': "D:20261007120000-05'00'"})
w2.write(f'{out}/memo.pdf')
os.remove(f'{out}/memo_base.pdf'); os.remove(f'{out}/memo_full.pdf')
print('wrote office + pdf fixtures to', out)
