import { sk } from '@intra/shared/i18n';
import { Body, Button, Container, Head, Html, Link, Preview, Text } from '@react-email/components';
import type { SecondFactorChange } from '../db/schema/mail-outbox.js';

const t = sk.email;

const main = { backgroundColor: '#f4f6f6', fontFamily: 'Helvetica, Arial, sans-serif' };
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  margin: '32px auto',
  padding: '32px',
  maxWidth: '480px',
};
const text = { color: '#1f2933', fontSize: '15px', lineHeight: '24px' };
const muted = { ...text, color: '#616e7c', fontSize: '13px', lineHeight: '20px' };
const button = {
  backgroundColor: '#0f766e',
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '15px',
  padding: '12px 20px',
};

function Layout(props: {
  preview: string;
  lines: string[];
  action: string;
  url: string;
  footer?: string;
}) {
  return (
    <Html lang="sk">
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={main}>
        <Container style={card}>
          <Text style={text}>{t.greeting}</Text>
          {props.lines.map((line) => (
            <Text key={line} style={text}>
              {line}
            </Text>
          ))}
          <Button href={props.url} style={button}>
            {props.action}
          </Button>
          <Text style={muted}>{t.linkFallback}</Text>
          <Link href={props.url} style={muted}>
            {props.url}
          </Link>
          {props.footer ? <Text style={muted}>{props.footer}</Text> : null}
          <Text style={text}>{t.signature}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function PasswordResetEmail({ url }: { url: string }) {
  const m = t.passwordReset;
  return (
    <Layout preview={m.subject} lines={[m.body]} action={m.action} url={url} footer={t.ignore} />
  );
}

export function InvitationEmail(props: { url: string; invitedByName: string | null }) {
  const m = t.invitation;
  const lines = [
    props.invitedByName === null ? m.body : m.bodyBy(props.invitedByName),
    m.secondFactor,
    m.valid,
  ];
  return <Layout preview={m.subject} lines={lines} action={m.action} url={props.url} />;
}

/**
 * Her second factor was switched on, moved to a new phone, or reset by a colleague. Sent to the
 * account, so that a change she did not make is noticed: which change, and nothing else, never a
 * secret, a code or a recovery code.
 */
export function SecondFactorChangedEmail(props: { url: string; change: SecondFactorChange }) {
  const m = t.secondFactorChanged;
  return (
    <Layout
      preview={m.subject}
      lines={[m[props.change]]}
      action={m.action}
      url={props.url}
      footer={m.notYou}
    />
  );
}
