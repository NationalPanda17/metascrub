"""Generate metadata-laden test images. Requires Pillow: pip install pillow"""
import io, os, sys
from PIL import Image, PngImagePlugin
out = sys.argv[1] if len(sys.argv) > 1 else 'tests/fixtures'
os.makedirs(out, exist_ok=True)
img = Image.new('RGB', (320, 200), (200, 80, 40))
ex = Image.Exif()
ex[0x010f] = 'Apple'; ex[0x0110] = 'iPhone 15 Pro'; ex[0x0131] = '17.1'; ex[0x0132] = '2026:10:02 14:03:11'; ex[0x0112] = 6; ex[0x013b] = 'Jane Doe'
e = ex.get_ifd(0x8769); e[0x9003] = '2026:10:02 14:03:11'; e[0xa431] = 'SN-55512345'
g = ex.get_ifd(0x8825); g[1] = 'N'; g[2] = (38.0, 48.0, 17.4); g[3] = 'W'; g[4] = (77.0, 2.0, 47.1)
xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Adobe Photoshop 25.0"/></rdf:RDF></x:xmpmeta>'
b = io.BytesIO(); img.save(b, 'JPEG', exif=ex.tobytes(), xmp=xmp, comment=b'secret comment')
open(f'{out}/test.jpg', 'wb').write(b.getvalue() + b'\xff\xd8\xff\xe0HIDDEN\xff\xd9')
info = PngImagePlugin.PngInfo(); info.add_text('Author', 'Jane Doe'); info.add_text('Software', 'GIMP', zip=True)
img.save(f'{out}/test.png', pnginfo=info, exif=ex.tobytes())
img.save(f'{out}/test.webp', exif=ex.tobytes(), xmp=xmp)
img.save(f'{out}/plain.jpg')
