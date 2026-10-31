import type { EmailLook, EmailNode } from '@intra/shared/schemas';
import { emailDocProblem } from '@intra/shared/schemas';
import { renderEmail } from './render.js';
import { fromAddress } from './templates.service.js';

const look: EmailLook = {
  logoKey: 'abcdefghijklmnop.png',
  headerStyle: 'dark',
  brandName: 'Alma ADOS',
  headerDoc: null,
  senderNameDoc: null,
  accent: '#b45309',
  footerCompany: '',
  footerIco: '',
  footerWeb: '',
  footerEmail: '',
  replyMode: 'company',
  replyToAddress: 'info@alma-care.eu',
};

const body: EmailNode = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'logo' },
        { type: 'text', text: 'Alma ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'ADOS', marks: [{ type: 'bold' }, { type: 'accent' }] },
      ],
    },
  ],
};

const rendered = (over: Partial<EmailLook>) =>
  renderEmail({
    look: { ...look, ...over },
    baseUrl: 'https://intra.example.test',
    subject: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'S' }] }],
    },
    body,
    values: {},
    labels: {},
    signature: false,
  });

/** The paragraph of the body, without the header, which has its own logo. */
const paragraph = (html: string) => /<p[^>]*>.*?ADOS.*?<\/p>/s.exec(html)![0];

describe('the logo and the accent within a line', () => {
  it('are allowed in a document', () => {
    expect(emailDocProblem(body, new Set())).toBeNull();
  });

  it('show the logo of the look at the height of the text', async () => {
    const line = paragraph((await rendered({})).html);
    expect(line).toContain('https://intra.example.test/m/abcdefghijklmnop.png');
    expect(line).toContain('height:18px');
    expect(line).toContain('vertical-align:-3px');
  });

  it('colour the text with the accent of the look', async () => {
    const line = paragraph((await rendered({ accent: '#334e7b' })).html);
    expect(line).toContain('color:#334e7b');
  });

  it('leave out the logo when the look has none', async () => {
    const out = await rendered({ logoKey: null });
    expect(out.html).not.toContain('/m/');
    expect(out.text).toContain('Alma ADOS');
  });
});

describe('a logo of its own within a line', () => {
  it('wins over the logo of the look and is refused when it is not an image key', async () => {
    const own: EmailNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'logo', attrs: { src: 'zzzzzzzzzzzzzzzzzzzz.png' } },
            { type: 'text', text: 'ADOS' },
          ],
        },
      ],
    };
    expect(emailDocProblem(own, new Set())).toBeNull();
    const out = await renderEmail({
      look,
      baseUrl: 'https://intra.example.test',
      subject: own,
      body: own,
      values: {},
      labels: {},
      signature: false,
    });
    expect(paragraph(out.html)).toContain('/m/zzzzzzzzzzzzzzzzzzzz.png');
    expect(paragraph(out.html)).not.toContain('/m/abcdefghijklmnop.png');
    expect(
      emailDocProblem(
        {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'logo', attrs: { src: 'https://x.test/a' } }] },
          ],
        },
        new Set(),
      ),
    ).toBe('invalid_image');
  });
});

describe('a paragraph set to the width of the e-mail', () => {
  const paragraphOf = async (node: EmailNode) => {
    const doc: EmailNode = { type: 'doc', content: [node] };
    const out = await renderEmail({
      look,
      baseUrl: 'https://intra.example.test',
      subject: doc,
      body: doc,
      values: {},
      labels: {},
      signature: false,
    });
    return paragraph(out.html);
  };
  const name: EmailNode[] = [
    { type: 'text', text: 'o produkt ' },
    { type: 'logo' },
    { type: 'text', text: 'Alma ', marks: [{ type: 'bold' }] },
    { type: 'text', text: 'ADOS', marks: [{ type: 'bold' }, { type: 'accent' }] },
    { type: 'text', text: ' a za kontakt' },
  ];

  it('is justified only when it says so', async () => {
    const line = { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'ADOS' }] };
    expect(await paragraphOf({ ...line, attrs: { align: 'justify' } })).toContain(
      'text-align:justify',
    );
    expect(await paragraphOf(line)).not.toContain('text-align');
  });

  it('keeps a logo on one line with the name after it, and the rest of the text out', async () => {
    const line = await paragraphOf({ type: 'paragraph', content: name });
    const glued = /<span style="white-space:nowrap">(.*?)<\/span>(?=\s*(<!-- -->)? a)/s.exec(line)!;
    expect(glued[1]).toContain('/m/abcdefghijklmnop.png');
    expect(glued[1]).toContain('Alma');
    expect(glued[1]).toContain('ADOS');
    expect(glued[1]).not.toContain('kontakt');
    expect(line).toContain('za kontakt');
  });

  it('cuts a text at its first ordinary space when the name is in one piece', async () => {
    const line = await paragraphOf({
      type: 'paragraph',
      content: [{ type: 'logo' }, { type: 'text', text: 'Alma ADOS a za' }],
    });
    expect(line).toMatch(/white-space:nowrap.*Alma.ADOS<\/span>/s);
    expect(line).toContain('za');
  });
});

describe('who an e-mail is from', () => {
  const from = (footerCompany: string, brandName = 'Alma ADOS') =>
    fromAddress({ ...look, brandName, footerCompany }, 'info@mail.test');

  it('is the brand and the company', () => {
    expect(from('Alma Care Solutions')).toBe('Alma ADOS | Alma Care Solutions <info@mail.test>');
  });

  it('is the brand alone without a company, or when both are the same', () => {
    expect(from('')).toBe('Alma ADOS <info@mail.test>');
    expect(from('Alma', 'Alma')).toBe('Alma <info@mail.test>');
  });

  it('is the name written in the settings, its variables filled for the recipient', async () => {
    const senderNameDoc: EmailNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'variable', attrs: { name: 'sender.name' } },
            { type: 'text', text: ' | Alma' },
          ],
        },
      ],
    };
    const empty: EmailNode = { type: 'doc', content: [{ type: 'paragraph' }] };
    const options = {
      look: { ...look, senderNameDoc },
      baseUrl: 'https://intra.test',
      subject: empty,
      body: empty,
      labels: {},
      signature: false,
    };
    const filled = await renderEmail({ ...options, values: { 'sender.name': 'Eva, Tóthová' } });
    expect(filled.fromName).toBe('Eva, Tóthová | Alma');
    expect(fromAddress(options.look, 'info@mail.test', filled.fromName)).toBe(
      '"Eva, Tóthová | Alma" <info@mail.test>',
    );
    // A value missing: the brand rather than a broken name.
    expect((await renderEmail({ ...options, values: {} })).fromName).toBe('Alma ADOS');
  });

  it('goes in quotes when a comma would split the address', () => {
    expect(from('Alma, s.r.o.')).toBe('"Alma ADOS | Alma, s.r.o." <info@mail.test>');
  });
});

describe('the text in the header', () => {
  it('keeps its lines and their bold and italic', async () => {
    const out = await rendered({
      headerDoc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Prvý', marks: [{ type: 'bold' }] }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Druhý' },
              { type: 'hardBreak' },
              { type: 'text', text: 'Tretí', marks: [{ type: 'italic' }] },
            ],
          },
        ],
      },
    });
    expect(out.html).toMatch(/<div><strong>Prvý<\/strong><\/div>/);
    expect(out.html).toMatch(
      /<div>(<!-- -->)?Druhý(<!-- -->)?<br\/?>(<!-- -->)?<em>Tretí<\/em><\/div>/,
    );
  });
});

describe('the brand in the header', () => {
  const header = (html: string) => html.slice(0, html.indexOf('<p '));

  it('sets the words after the first in a light colour on a dark header', async () => {
    const out = await rendered({});
    expect(header(out.html)).toMatch(/color:#5fd0c9[^>]*> <!-- -->ADOS</);
    expect(out.text).toContain('Alma ADOS');
  });

  it('sets them in the accent on a light header', async () => {
    const out = await rendered({ headerStyle: 'light', accent: '#334e7b' });
    expect(header(out.html)).toMatch(/color:#334e7b[^>]*> <!-- -->ADOS</);
  });

  it('leaves a name of one word as it is', async () => {
    const out = await rendered({ brandName: 'Alma' });
    expect(header(out.html)).not.toContain('#5fd0c9');
  });

  describe('a button that records interest', () => {
    const PRODUCT = '00000000-0000-4000-8000-0000000000a1';
    const withButton: EmailNode = {
      type: 'doc',
      content: [
        { type: 'button', attrs: { text: 'Mám záujem', href: '', interestProductId: PRODUCT } },
      ],
    };
    const options = {
      look,
      baseUrl: 'https://intra.test',
      subject: withButton,
      body: withButton,
      values: {},
      labels: {},
      signature: false,
    };

    it('carries the link made for the recipient', async () => {
      const out = await renderEmail({
        ...options,
        activityUrl: ({ productId }) => `https://intra.test/zaujem#token-${productId}`,
      });
      expect(out.html).toContain(`https://intra.test/zaujem#token-${PRODUCT}`);
    });

    it('in a preview or a test opens the page without a token', async () => {
      const out = await renderEmail(options);
      expect(out.html).toContain('href="https://intra.test/zaujem"');
    });
  });

  describe('a button in the middle', () => {
    const withButton = (attrs: Record<string, unknown>): EmailNode => ({
      type: 'doc',
      content: [{ type: 'button', attrs: { text: 'Viac', href: 'https://a.test', ...attrs } }],
    });
    const sectionOf = async (doc: EmailNode) => {
      const out = await renderEmail({
        look,
        baseUrl: 'https://intra.test',
        subject: doc,
        body: doc,
        values: {},
        labels: {},
        signature: false,
      });
      const at = out.html.indexOf('https://a.test');
      return out.html.slice(out.html.lastIndexOf('<table', at), at);
    };

    it('is centred only when it says so', async () => {
      expect(await sectionOf(withButton({ align: 'center' }))).toContain('text-align:center');
      expect(await sectionOf(withButton({}))).not.toContain('text-align:center');
    });
  });
});
