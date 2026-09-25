# Flipbook engine

`page-flip.browser.js` is copied unchanged from:
https://github.com/agebp21/sarvamaya-flipbook-studio

Commit: `dcc2b6fc6ca27a812e566858ff28d61332c642ec`
Path: `flipbook_studio/templates/html/page-flip.browser.js`

The interactive infographic demo uses this engine to turn HTML pages. Animation, controls, and sample content are implemented separately in `assets/animation.js` and `assets/animation.css`.

## PDF.js

PDF.js 3.11.174 (`pdf.min.js`, `pdf.worker.min.js`) is bundled from
https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/
for rendering PDFs locally, matching the converter's existing version.
Upstream: https://github.com/mozilla/pdf.js (Apache-2.0).
The reader disables PDF JavaScript evaluation with `isEvalSupported: false`.

## Offline exports

JSZip 3.10.1 (`jszip.min.js`) is bundled from
https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
under its MIT license (see `JSZIP-LICENSE.txt`).

The PageFlip upstream MIT license is included as `PAGEFLIP-LICENSE.txt`,
from https://github.com/Nodlik/StPageFlip/blob/master/LICENSE.

- pdf-lib 1.17.1: official npm distribution (pdf-lib/dist/pdf-lib.min.js); MIT license in PDFLIB-LICENSE.md. Used locally to turn imported images into valid PDFs in the animation editor.

- OCR editor: Tesseract.js 5.1.1 and tesseract.js-core 5.1.1, unmodified npm distributions (Apache-2.0), under `ocr/`. Core .wasm.js distributions embed WASM, including SIMD/LSTM variants. Engine docs: https://github.com/naptha/tesseract.js/blob/v5.1.1/docs/api.md . Language data eng/ind/msa from tesseract-ocr/tessdata_fast tag 4.1.0 (Apache-2.0), gzip-compressed for local loading: https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0 . License files included. OCR does not upload documents or require CDN access.
