import type { EmailLook, EmailNode } from '@intra/shared/schemas';
import { emailDocProblem } from '@intra/shared/schemas';
import { renderEmail } from './render.js';

const look: EmailLook = {
  logoKey: 'abcdefghijklmnop.png',
  headerStyle: 'dark',
  brandName: 'Alma ADOS',
  headerText: '',
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
});
