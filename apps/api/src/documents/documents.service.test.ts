import PizZip from 'pizzip';
import { docxText } from '../mcp/text.js';
import { DocumentError, fillTemplate, templateTags } from './documents.service.js';

/** The smallest DOCX Word opens: one paragraph per line, the text as given. */
function docx(lines: string[]) {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const body = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`,
  );
  return zip.generate({ type: 'uint8array' });
}

const template = docx([
  '{salutation},',
  'posielame ponuku pre {customer.name}: {offer.price} € mesačne.',
  's pozdravom {sender.name}',
]);

describe('document templates', () => {
  it('find the placeholders, variables and fields alike', () => {
    expect(templateTags(template)).toEqual([
      'salutation',
      'customer.name',
      'offer.price',
      'sender.name',
    ]);
  });

  it('fill them in by name, dots included; a missing one leaves its place empty', () => {
    const filled = fillTemplate(template, {
      salutation: 'Vážená pani riaditeľka',
      'customer.name': 'ADOS Harmónia, s.r.o.',
      'offer.price': '1 200',
    });
    expect(docxText(filled)).toBe(
      'Vážená pani riaditeľka,\nposielame ponuku pre ADOS Harmónia, s.r.o.: 1 200 € mesačne.\ns pozdravom',
    );
  });

  it('refuse a template that is not one', () => {
    expect(() => templateTags(docx(['{neuzavretá']))).toThrow(DocumentError);
    expect(() => templateTags(new TextEncoder().encode('not a docx'))).toThrow(DocumentError);
  });
});
