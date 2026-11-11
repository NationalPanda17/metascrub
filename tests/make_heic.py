"""Build iPhone-style HEIC fixtures (ISOBMFF/HEIF container) with EXIF, GPS, XMP, a thumbnail and a depth matte.
The image payload is a placeholder (parsers never decode pixels), but the box layout mirrors Apple's files:
ftyp(heic) + meta[hdlr pict, pitm, iloc, iinf/infe v2, iref cdsc/thmb/auxl, iprp(ipco: hvcC, ispe, irot, auxC; ipma)] + mdat.
Usage: python3 tests/make_heic.py OUT_DIR   (needs Pillow for EXIF bytes)"""
import struct, sys, os
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'
os.makedirs(out, exist_ok=True)

def box(t, payload): return struct.pack('>I', 8 + len(payload)) + t.encode() + payload
def fbox(t, v, flags, payload): return box(t, struct.pack('>I', (v << 24) | flags) + payload)

ex = Image.Exif()
ex[0x010f] = 'Apple'; ex[0x0110] = 'iPhone 16 Pro'; ex[0x0131] = '18.1'; ex[0x0132] = '2026:11:02 09:14:55'; ex[0x0112] = 6
e = ex.get_ifd(0x8769); e[0x9003] = '2026:11:02 09:14:55'; e[0x9011] = '-05:00'; e[0xa434] = 'iPhone 16 Pro back triple camera 6.765mm f/1.78'; e[0xa433] = 'Apple'
g = ex.get_ifd(0x8825); g[1] = 'N'; g[2] = (38.0, 48.0, 15.21); g[3] = 'W'; g[4] = (77.0, 2.0, 49.8); g[6] = 14.2
exif_tiff = ex.tobytes()  # b'Exif\0\0' + TIFF
exif_payload = struct.pack('>I', 6) + exif_tiff        # HEIF Exif item: 4-byte offset to TIFF header, then data
xmp = (b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmp:CreatorTool="18.1" xmp:CreateDate="2026-11-02T09:14:55-05:00" photoshop:DateCreated="2026-11-02T09:14:55-05:00"/>'
       b'</rdf:RDF></x:xmpmeta><?xpacket end="w"?>')
image = b'\x00\x00\x00\x10HEVC-PLACEHOLDER' * 64
thumb = b'\x00\x00\x00\x10HEVC-THUMBNAIL!!' * 8
matte = b'\x00\x00\x00\x10HEVC-DEPTHMATTE!' * 8

def build(iloc_version, use_idat):
    items = [(1, 'hvc1', '', image), (2, 'Exif', '', exif_payload), (3, 'mime', 'application/rdf+xml', xmp), (4, 'hvc1', '', thumb), (5, 'hvc1', '', matte)]
    infe = b''.join(fbox('infe', 2, 1 if i == 5 else 0, struct.pack('>HH', i, 0) + t.encode() + b'\0' + (ct.encode() + b'\0' if t == 'mime' else b'')) for i, t, ct, _ in items)
    iinf = fbox('iinf', 0, 0, struct.pack('>H', len(items)) + infe)
    iref = fbox('iref', 0, 0, box('cdsc', struct.pack('>HHH', 2, 1, 1)) + box('cdsc', struct.pack('>HHH', 3, 1, 1)) + box('thmb', struct.pack('>HHH', 4, 1, 1)) + box('auxl', struct.pack('>HHH', 5, 1, 1)))
    hvcC = box('hvcC', b'\x01' + b'\0' * 22)
    ispe = fbox('ispe', 0, 0, struct.pack('>II', 4032, 3024))
    irot = box('irot', b'\x03')
    auxC = fbox('auxC', 0, 0, b'urn:com:apple:photo:2018:aux:portraiteffectsmatte\0')
    ispe_s = fbox('ispe', 0, 0, struct.pack('>II', 416, 312))
    ipco = box('ipco', hvcC + ispe + irot + auxC + ispe_s)
    # ipma (version 0, flags 0): item -> property indices (1-based, high bit = essential)
    ipma = fbox('ipma', 0, 0, struct.pack('>I', 3) + struct.pack('>HB', 1, 3) + bytes([0x81, 2, 3]) + struct.pack('>HB', 4, 2) + bytes([0x81, 5]) + struct.pack('>HB', 5, 3) + bytes([0x81, 4, 5]))
    iprp = box('iprp', ipco + ipma)
    hdlr = fbox('hdlr', 0, 0, b'\0\0\0\0pict' + b'\0' * 12 + b'\0')
    pitm = fbox('pitm', 0, 0, struct.pack('>H', 1))
    ftyp = box('ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heicMiHEMiPr')

    def iloc_box(offsets, methods):
        if iloc_version == 0:
            body = bytes([0x44, 0x00]) + struct.pack('>H', len(items))
            for (i, *_), off in zip(items, offsets):
                body += struct.pack('>HH', i, 0) + struct.pack('>H', 1) + struct.pack('>II', off, len(_[2]))
        else:
            body = bytes([0x44, 0x40]) + struct.pack('>H', len(items))  # offset 4, length 4, base 4, index 0
            for (i, t, ct, data), off, m in zip(items, offsets, methods):
                body += struct.pack('>HHH', i, m, 0) + struct.pack('>I', 0) + struct.pack('>H', 1) + struct.pack('>II', off, len(data))
        return fbox('iloc', iloc_version, 0, body)

    methods = [0, 1 if use_idat else 0, 1 if use_idat else 0, 0, 0]
    idat_data = (exif_payload + xmp) if use_idat else b''
    idat = box('idat', idat_data) if use_idat else b''
    # two passes so absolute offsets are right
    dummy = iloc_box([0] * len(items), methods)
    meta_len = len(fbox('meta', 0, 0, hdlr + pitm + dummy + iinf + iref + iprp + idat))
    mdat_start = len(ftyp) + meta_len + 8
    offsets, cur = [], mdat_start
    mdat_payload = b''
    idat_cur = 0
    for (i, t, ct, data), m in zip(items, methods):
        if m == 1: offsets.append(idat_cur); idat_cur += len(data)
        else: offsets.append(cur); cur += len(data); mdat_payload += data
    meta = fbox('meta', 0, 0, hdlr + pitm + iloc_box(offsets, methods) + iinf + iref + iprp + idat)
    assert len(meta) == meta_len
    return ftyp + meta + box('mdat', mdat_payload)

open(f'{out}/iphone.heic', 'wb').write(build(1, False))
open(f'{out}/iphone_idat.heic', 'wb').write(build(1, True))
open(f'{out}/iloc_v0.heic', 'wb').write(build(0, False))
print('wrote HEIC fixtures to', out)
