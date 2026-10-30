import { sk } from '@intra/shared/i18n';
import type { EmailLook, EmailNode } from '@intra/shared/schemas';
import { brandParts, interestProductOf, OPTIONAL_VARIABLES } from '@intra/shared/schemas';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  render,
  Row,
  Section,
  Text,
} from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';

const t = sk.templates;

/**
 * How a variable shows: its value; in a preview without one, a red chip naming what is missing.
 * When sending, a missing value is refused before any rendering (spec 6.3).
 */
export type Values = Readonly<Record<string, string | undefined>>;

export interface RenderInput {
  look: EmailLook;
  /** Where `/m/<key>` images are served: the web's own address. */
  baseUrl: string;
  subject: EmailNode;
  body: EmailNode;
  values: Values;
  /** Labels of the custom fields, for the missing chips. */
  labels: Readonly<Record<string, string>>;
  /** Shown under the body; the values of `sender.*` fill it. */
  signature: boolean;
  /** The customer the recipient belongs to, for the footer's reason line. */
  customerName?: string | undefined;
  unsubscribeUrl?: string | undefined;
  /**
   * The recipient's own link of a button that records interest. Without it (a preview, a test, a
   * recipient not in Kontakty) the button opens the public page, which calls the link invalid.
   */
  interestUrl?: ((productId: string) => string) | undefined;
  /** Files sent as download links instead of attachments (D-26), listed under the body. */
  downloads?: { expiresAt: Date; files: { name: string; url: string }[] } | undefined;
}

/** An attribute of a node as text: what the schema stored, or nothing. */
const str = (value: unknown) => (typeof value === 'string' ? value : '');

const FONT = 'Helvetica, Arial, sans-serif';
const INK = '#1f2933';
const MUTED = '#616e7c';
const text: CSSProperties = {
  margin: '0 0 16px',
  fontSize: '15px',
  lineHeight: '24px',
  color: INK,
};
const chip: CSSProperties = {
  display: 'inline-block',
  padding: '0 6px',
  borderRadius: '6px',
  background: '#fce8e8',
  color: '#b0232a',
  fontWeight: 600,
};

function labelOf(name: string, labels: RenderInput['labels']): string {
  if (name.startsWith('custom.')) return labels[name.slice('custom.'.length)] ?? name;
  return (t.variables as Record<string, unknown>)[name] as string;
}

/** The plain value of a one-paragraph document: the subject. */
export function plainOf(doc: EmailNode, values: Values, labels: RenderInput['labels']): string {
  const walk = (node: EmailNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'variable') {
      const name = str(node.attrs?.name);
      if (OPTIONAL_VARIABLES.includes(name)) return values[name] ?? '';
      return values[name] ?? `[${labelOf(name, labels)}]`;
    }
    if (node.type === 'hardBreak') return ' ';
    return (node.content ?? []).map(walk).join(node.type === 'doc' ? ' ' : '');
  };
  return walk(doc).replace(/\s+/g, ' ').trim();
}

/** Every variable the documents use that has no value. */
export function missingOf(docs: EmailNode[], values: Values): string[] {
  const missing: string[] = [];
  const walk = (node: EmailNode) => {
    if (node.type === 'variable') {
      const name = str(node.attrs?.name);
      if (!values[name]?.trim() && !OPTIONAL_VARIABLES.includes(name) && !missing.includes(name))
        missing.push(name);
    }
    for (const child of node.content ?? []) walk(child);
  };
  docs.forEach(walk);
  return missing;
}

function Marks({
  node,
  accent,
  children,
}: {
  node: EmailNode;
  accent: string;
  children: ReactNode;
}) {
  let out = children;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>;
    if (mark.type === 'italic') out = <em>{out}</em>;
    if (mark.type === 'accent') out = <span style={{ color: accent }}>{out}</span>;
    if (mark.type === 'link') {
      out = (
        <Link href={str(mark.attrs?.href)} style={{ color: accent, textDecoration: 'underline' }}>
          {out}
        </Link>
      );
    }
  }
  return <>{out}</>;
}

function Nodes({ nodes, ctx }: { nodes: EmailNode[] | undefined; ctx: Ctx }) {
  return (
    <>
      {(nodes ?? []).map((node, i) => (
        <NodeView key={i} node={node} ctx={ctx} />
      ))}
    </>
  );
}

interface Ctx {
  input: RenderInput;
  accent: string;
}

function NodeView({ node, ctx }: { node: EmailNode; ctx: Ctx }): ReactNode {
  const { input, accent } = ctx;
  switch (node.type) {
    case 'doc':
      return <Nodes nodes={node.content} ctx={ctx} />;
    case 'paragraph':
      return (
        <Text style={text}>
          <Nodes nodes={node.content} ctx={ctx} />
        </Text>
      );
    case 'heading': {
      const level = node.attrs?.level === 3 ? 'h3' : 'h2';
      return (
        <Heading
          as={level}
          style={{
            margin: '24px 0 12px',
            fontSize: level === 'h2' ? '20px' : '17px',
            lineHeight: level === 'h2' ? '28px' : '24px',
            color: INK,
          }}
        >
          <Nodes nodes={node.content} ctx={ctx} />
        </Heading>
      );
    }
    case 'text':
      return (
        <Marks node={node} accent={accent}>
          {node.text}
        </Marks>
      );
    case 'hardBreak':
      return <br />;
    case 'logo': {
      // A logo of its own, or the look's, at the height of the text, its middle in the middle of
      // the line. Without an alt: the name stands beside it, and a client that blocks images shows
      // nothing extra.
      const logoKey = str(node.attrs?.src) || input.look.logoKey;
      return logoKey ? (
        <Img
          src={`${input.baseUrl}/m/${logoKey}`}
          alt=""
          height={18}
          style={{
            display: 'inline-block',
            height: '18px',
            width: 'auto',
            borderRadius: '5px',
            verticalAlign: '-3px',
            marginRight: '4px',
          }}
        />
      ) : null;
    }
    case 'bulletList':
    case 'orderedList': {
      const List = node.type === 'bulletList' ? 'ul' : 'ol';
      return (
        <List style={{ margin: '0 0 16px', paddingLeft: '22px', color: INK }}>
          {(node.content ?? []).map((item, i) => (
            <li key={i} style={{ fontSize: '15px', lineHeight: '24px' }}>
              {(item.content ?? []).map((child, j) =>
                child.type === 'paragraph' ? (
                  <Nodes key={j} nodes={child.content} ctx={ctx} />
                ) : (
                  <NodeView key={j} node={child} ctx={ctx} />
                ),
              )}
            </li>
          ))}
        </List>
      );
    }
    case 'horizontalRule':
      return <Hr style={{ borderColor: '#e5eaea', margin: '24px 0' }} />;
    case 'image': {
      const width = Math.min(Number(node.attrs?.width) || 536, 536);
      return (
        <Img
          src={`${input.baseUrl}/m/${str(node.attrs?.src)}`}
          alt={str(node.attrs?.alt)}
          width={width}
          style={{
            display: 'block',
            maxWidth: '100%',
            height: 'auto',
            margin: '0 0 16px',
            borderRadius: '8px',
          }}
        />
      );
    }
    case 'button': {
      const interest = interestProductOf(node);
      const href = interest
        ? (input.interestUrl?.(interest) ?? `${input.baseUrl}/zaujem`)
        : str(node.attrs?.href);
      return (
        <Section style={{ margin: '8px 0 24px' }}>
          <Button
            href={href}
            style={{
              backgroundColor: accent,
              color: '#ffffff',
              borderRadius: '10px',
              padding: '12px 20px',
              fontWeight: 700,
              fontSize: '15px',
              textDecoration: 'none',
            }}
          >
            {str(node.attrs?.text)}
          </Button>
        </Section>
      );
    }
    case 'callout':
      return (
        <Section
          style={{
            margin: '0 0 16px',
            padding: '16px 18px 0',
            borderRadius: '10px',
            background: '#f0f8f7',
          }}
        >
          <Nodes nodes={node.content} ctx={ctx} />
        </Section>
      );
    case 'columns':
      return (
        <Section style={{ margin: '0 0 8px' }}>
          <Row>
            {(node.content ?? []).slice(0, 2).map((column, i) => (
              <Column
                key={i}
                style={{
                  width: '50%',
                  verticalAlign: 'top',
                  paddingRight: i === 0 ? '12px' : 0,
                  paddingLeft: i === 1 ? '12px' : 0,
                }}
              >
                <Nodes nodes={column.content} ctx={ctx} />
              </Column>
            ))}
          </Row>
        </Section>
      );
    case 'variable': {
      const name = str(node.attrs?.name);
      const value = input.values[name];
      if (value?.trim()) return <>{value}</>;
      // A prevádzka's variable for a person at none: simply left out.
      if (OPTIONAL_VARIABLES.includes(name)) return null;
      return <span style={chip}>{t.variables.missing(labelOf(name, input.labels))}</span>;
    }
    default:
      return null;
  }
}

/** The whole e-mail: the company header, the body, the sender's signature and the footer. */
export function EmailDocument({ input }: { input: RenderInput }) {
  const { look } = input;
  const dark = look.headerStyle === 'dark';
  const brand = brandParts(look);
  const ctx: Ctx = { input, accent: look.accent };
  const sender = {
    name: input.values['sender.name'],
    position: input.values['sender.position'],
    phone: input.values['sender.phone'],
  };
  return (
    <Html lang="sk">
      <Head />
      <Preview>{plainOf(input.subject, input.values, input.labels)}</Preview>
      <Body style={{ margin: 0, background: '#f4f6f6', fontFamily: FONT, color: INK }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '24px 12px' }}>
          <Section style={{ borderRadius: '12px', overflow: 'hidden', background: '#ffffff' }}>
            <Section
              style={{
                background: dark ? '#0c3b3c' : '#ffffff',
                borderBottom: dark ? 'none' : '1px solid #e5eaea',
                padding: '22px 32px',
              }}
            >
              <Row>
                <Column style={{ width: '1%', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  {look.logoKey ? (
                    <Img
                      src={`${input.baseUrl}/m/${look.logoKey}`}
                      alt={look.brandName}
                      height={36}
                      style={{
                        display: 'inline-block',
                        height: '36px',
                        width: 'auto',
                        borderRadius: '8px',
                        verticalAlign: 'middle',
                      }}
                    />
                  ) : null}
                  <span
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: dark ? '#ffffff' : '#0c3b3c',
                      marginLeft: look.logoKey ? '12px' : 0,
                      verticalAlign: 'middle',
                    }}
                  >
                    {brand.first}
                    {brand.rest ? (
                      <span style={{ color: brand.restColor }}> {brand.rest}</span>
                    ) : null}
                  </span>
                </Column>
                <Column
                  style={{ textAlign: 'right', fontSize: '12px', color: dark ? '#a9c9c7' : MUTED }}
                >
                  {look.headerText}
                </Column>
              </Row>
            </Section>

            <Section style={{ padding: '32px 32px 8px' }}>
              <NodeView node={input.body} ctx={ctx} />
              {input.downloads && input.downloads.files.length > 0 ? (
                <Section style={{ margin: '4px 0 16px' }}>
                  <Text style={{ ...text, margin: '0 0 6px', fontWeight: 700 }}>
                    {t.downloads.title}
                  </Text>
                  {input.downloads.files.map((file) => (
                    <Text key={file.url} style={{ ...text, margin: '0 0 4px' }}>
                      <Link href={file.url} style={{ color: look.accent }}>
                        {file.name}
                      </Link>
                    </Text>
                  ))}
                  <Text style={{ ...text, margin: '6px 0 0', fontSize: '13px', color: MUTED }}>
                    {t.downloads.valid(
                      input.downloads.expiresAt
                        .toLocaleDateString('sk-SK', { timeZone: 'Europe/Bratislava' })
                        .replace(/\s/g, ''),
                    )}
                  </Text>
                </Section>
              ) : null}
              {input.signature ? (
                <Section
                  style={{ marginTop: '12px', paddingTop: '20px', borderTop: '1px solid #e5eaea' }}
                >
                  <Text style={{ ...text, margin: 0 }}>{t.signature.greeting}</Text>
                  <Text style={{ ...text, margin: '12px 0 0', fontWeight: 700 }}>
                    {sender.name ?? (
                      <span style={chip}>{t.variables.missing(t.variables['sender.name'])}</span>
                    )}
                  </Text>
                  <Text style={{ ...text, margin: '0 0 24px', color: MUTED, fontSize: '14px' }}>
                    {[sender.position, look.brandName, sender.phone].filter(Boolean).join(' · ')}
                  </Text>
                </Section>
              ) : null}
            </Section>

            <Section
              style={{
                padding: '20px 32px',
                background: '#f7f9f9',
                borderTop: '1px solid #e5eaea',
                fontSize: '12px',
                lineHeight: '18px',
                color: MUTED,
              }}
            >
              <Text style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: MUTED }}>
                {[
                  look.brandName,
                  look.footerCompany,
                  look.footerIco ? `IČO ${look.footerIco}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {look.footerEmail || look.footerWeb ? (
                <Text
                  style={{ margin: '2px 0 0', fontSize: '12px', lineHeight: '18px', color: MUTED }}
                >
                  {look.footerEmail ? (
                    <Link href={`mailto:${look.footerEmail}`} style={{ color: look.accent }}>
                      {look.footerEmail}
                    </Link>
                  ) : null}
                  {look.footerEmail && look.footerWeb ? ' · ' : null}
                  {look.footerWeb ? (
                    <Link
                      href={
                        /^https?:\/\//.test(look.footerWeb)
                          ? look.footerWeb
                          : `https://${look.footerWeb}`
                      }
                      style={{ color: look.accent }}
                    >
                      {look.footerWeb}
                    </Link>
                  ) : null}
                </Text>
              ) : null}
              {input.customerName ? (
                <Text
                  style={{ margin: '10px 0 0', fontSize: '12px', lineHeight: '18px', color: MUTED }}
                >
                  {t.footer.reason(input.customerName)}{' '}
                  {input.unsubscribeUrl ? (
                    <Link href={input.unsubscribeUrl} style={{ color: look.accent }}>
                      {t.footer.unsubscribe}
                    </Link>
                  ) : null}
                </Text>
              ) : null}
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** The e-mail as the provider gets it: subject, HTML and plain text, and what is missing. */
export async function renderEmail(input: RenderInput) {
  const element = <EmailDocument input={input} />;
  return {
    subject: plainOf(input.subject, input.values, input.labels),
    html: await render(element),
    text: await render(element, { plainText: true }),
    missing: missingOf([input.subject, input.body], input.values),
  };
}
