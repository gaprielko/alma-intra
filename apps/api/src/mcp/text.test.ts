import PizZip from 'pizzip';
import { extractText, MAX_TEXT_CHARS } from './text.js';

/** A PDF with one line of Helvetica text per page, offsets computed as a writer would. */
function pdfOf(pages: string[]) {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((line, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
    objects[pageIds[i]!] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** An XLSX with inline-string and number cells, one sheet per entry. */
function xlsxOf(sheets: Record<string, (string | number)[][]>) {
  const zip = new PizZip();
  const names = Object.keys(sheets);
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names
        .map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      '</sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  );
  names.forEach((name, i) => {
    const rows = sheets[name]!.map(
      (row, r) =>
        `<row r="${r + 1}">` +
        row
          .map((value, c) => {
            const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
            return typeof value === 'number'
              ? `<c r="${ref}"><v>${value}</v></c>`
              : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
          })
          .join('') +
        '</row>',
    ).join('');
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zip.generate({ type: 'uint8array' });
}

describe('files_read text', () => {
  it('reads a PDF page by page', async () => {
    const read = await extractText('Cennik.pdf', pdfOf(['Cennik 2027', 'Podmienky']));
    expect(read).toEqual({
      text: '--- Page 1 ---\nCennik 2027\n\n--- Page 2 ---\nPodmienky',
      cut: false,
    });
  });

  it('reads every sheet of an XLSX, cells tab-separated', async () => {
    const read = await extractText(
      'Ceny.xlsx',
      xlsxOf({
        Služby: [
          ['Služba', 'Cena'],
          ['Ošetrovanie', 25.5],
        ],
        Poznámky: [['Platí od 1. 1. 2027']],
      }),
    );
    expect(read?.text).toBe(
      '--- Sheet: Služby ---\nSlužba\tCena\nOšetrovanie\t25.5\n\n' +
        '--- Sheet: Poznámky ---\nPlatí od 1. 1. 2027',
    );
  });

  it('cuts a long text and says so, and leaves other types to Claude', async () => {
    const long = new TextEncoder().encode('a'.repeat(MAX_TEXT_CHARS + 10));
    expect(await extractText('dlhy.txt', long)).toEqual({
      text: 'a'.repeat(MAX_TEXT_CHARS),
      cut: true,
    });
    expect(await extractText('foto.png', new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
