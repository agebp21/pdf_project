"""Render the owner-provided catalog into local homepage sample assets."""
import json
from pathlib import Path
import pymupdf
from PIL import Image

source = Path(r'C:\Users\SARVAMAYA-3\Downloads\556711681-Sekar-Bumi-Catalog.pdf')
output = Path(__file__).resolve().parents[1] / 'assets' / 'samples' / 'sekar-bumi'
output.mkdir(parents=True, exist_ok=True)
document = pymupdf.open(source)
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1100/page.rect.width, 1100/page.rect.width), alpha=False)
    image = Image.frombytes('RGB', (pixmap.width, pixmap.height), pixmap.samples)
    image.save(output / f'page-{index+1:02}.webp', 'WEBP', quality=85)
print(f'Rendered {len(document)} catalog pages')
