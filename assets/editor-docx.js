'use strict';
// Word (.docx) export of the PDF editor's document (editor.html → File → Save as Word).
// Pages become flowing Word content, top to bottom: text blocks become paragraphs (their
// bold / italic / underline / colour / size / font, alignment; Heading 1-3 as Word's own
// heading styles so Word can build its table of contents), tables become Word tables,
// pictures inline pictures, and a page break between pages. Shapes and the page's printed
// background are left out (Word has no place for them in flowing text).
// EditorDocx.build(doc, JSZip) -> Promise<Blob>; doc: {title, margin (pt), pages: [{size: [W, H], elements}]}.
(() => {
  const C = globalThis.PageEditorCore;
  const FONT = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' };
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const twip = pt => Math.round(pt * 20);
  const emu = pt => Math.round(pt * 12700);
  const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };

  function run(text, r, el, H, heading) {          // heading: the Heading style sets size and weight
    const pr = [];
    const face = r.face ? r.face.replace(/["']/g, '').split(',')[0].trim() : FONT[el.family] || FONT.sans;
    pr.push(`<w:rFonts w:ascii="${esc(face)}" w:hAnsi="${esc(face)}" w:cs="${esc(face)}"/>`);
    if (!heading && (r.b ?? el.bold)) pr.push('<w:b/>');
    if (r.i ?? el.italic) pr.push('<w:i/>');
    const color = (r.color || el.color || '#1c1917').replace('#', '');
    if (/^[0-9a-f]{6}$/i.test(color)) pr.push(`<w:color w:val="${color}"/>`);
    const half = Math.max(2, Math.round(el.fontSize * H * (r.scale || 1) * 2));
    if (!heading) pr.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
    if (r.u ?? el.underline) pr.push('<w:u w:val="single"/>');
    return `<w:r><w:rPr>${pr.join('')}</w:rPr><w:t xml:space="preserve">${esc(C.clean(text))}</w:t></w:r>`;
  }
  function paragraphs(el, H) {
    const paras = C.richOf(el.text, el.html);
    const spacing = `<w:spacing w:after="80" w:line="${Math.round(240 * (el.lineHeight || C.LINE) / 1.15)}" w:lineRule="auto"/>`;
    return paras.map(para => {
      const level = el.toc ? 0 : C.headingLevel(para);       // the contents page itself is not a heading
      const style = level ? `<w:pStyle w:val="Heading${level}"/>` : '';
      const props = `<w:pPr>${style}${level ? '' : spacing}<w:jc w:val="${JC[el.align] || 'left'}"/></w:pPr>`;
      const runs = para.filter(r => r.text).map(r => run(r.text, r, el, H, !!level)).join('');
      return `<w:p>${props}${runs}</w:p>`;
    }).join('');
  }
  function table(el, W, H) {
    const width = el.w * W, cols = C.colWidths(el).map(f => twip(f * width));
    const border = (el.border || '#57534e').replace('#', '');
    const b = side => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="${border}"/>`;
    const grid = cols.map(c => `<w:gridCol w:w="${c}"/>`).join('');
    const rows = (el.rows || []).map((row, r) => {
      const head = !!el.header && r === 0;
      const cells = cols.map((cw, c) => {
        const lines = String(row[c] || '').split('\n');
        const ps = lines.map(t => `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${t ? run(t, { b: head || undefined }, el, H) : ''}</w:p>`).join('');
        const shade = head ? '<w:shd w:val="clear" w:color="auto" w:fill="F3F1EC"/>' : '';
        return `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${shade}</w:tcPr>${ps}</w:tc>`;
      }).join('');
      return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${twip(width)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders>` +
      `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl><w:p/>`;
  }
  function picture(rid, n, wPt, hPt) {
    const cx = emu(wPt), cy = emu(hPt);
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Gambar ${n}"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  const dataBytes = src => {
    const m = /^data:image\/(png|jpe?g)[^;]*;base64,(.*)$/i.exec(String(src || ''));
    if (!m) return null;
    const bin = typeof atob === 'function' ? atob(m[2]) : Buffer.from(m[2], 'base64').toString('binary');
    return { ext: /png/i.test(m[1]) ? 'png' : 'jpeg', bytes: Uint8Array.from(bin, ch => ch.charCodeAt(0)) };
  };

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${[1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="${[0, 360, 240, 200][n]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[0, 32, 28, 26][n]}"/><w:szCs w:val="${[0, 32, 28, 26][n]}"/></w:rPr></w:style>`).join('\n')}
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  async function build(doc, JSZip) {
    const zip = new JSZip(), media = [], rels = [];
    let pictures = 0;
    const body = [];
    doc.pages.forEach((pg, i) => {
      const [W, H] = pg.size;
      const items = (pg.elements || []).filter(e => ['text', 'table', 'image'].includes(e.type) && !(e.type === 'text' && !String(e.text || '').trim()))
        .sort((a, b) => a.y - b.y || a.x - b.x);
      for (const el of items) {
        if (el.type === 'text') body.push(paragraphs(el, H));
        else if (el.type === 'table') body.push(table(el, W, H));
        else {
          const data = dataBytes(el.src); if (!data) continue;
          pictures++;
          const file = `image${pictures}.${data.ext === 'png' ? 'png' : 'jpg'}`, rid = 'rIdImg' + pictures;
          media.push([file, data.bytes]); rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
          const maxW = W - 2 * (doc.margin || 72), wPt = Math.min(el.w * W, maxW), hPt = wPt * (el.h * H) / Math.max(1, el.w * W);
          body.push(picture(rid, pictures, wPt, hPt));
        }
      }
      if (i < doc.pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    });
    const [W, H] = (doc.pages[0] && doc.pages[0].size) || [595.28, 841.89], m = twip(doc.margin || 72);
    const sect = `<w:sectPr><w:pgSz w:w="${twip(W)}" w:h="${twip(H)}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title || '')}</dc:title><dc:creator>MyFlipbook Pro</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
    zip.file('word/styles.xml', STYLES);
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels.join('')}</Relationships>`);
    for (const [file, bytes] of media) zip.file('word/media/' + file, bytes);
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}${sect}</w:body></w:document>`);
    return zip.generateAsync({ type: typeof Blob !== 'undefined' ? 'blob' : 'uint8array',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }
  globalThis.EditorDocx = { build };
})();
