import { describe, expect, it } from 'vitest';
import { importKey, parseForwardDate, readForward } from './forwarded.js';

const gmailSk = `---------- Preposlaná správa ---------
Od: Eva Tóthová <eva@ados.sk>
Date: št 15. 10. 2026 o 9:12
Subject: Re: Cenová ponuka
To: Gabriel <gabriel@example.com>
Cc: Marek <marek@ados.sk>, peter@ados.sk


Dobrý deň,
s ponukou súhlasíme.

S pozdravom, Eva

Dňa st 14. 10. 2026 o 16:00 Gabriel <gabriel@example.com> napísal(a):
> Posielam ponuku.
`;

const gmailEn = `Pozri si toto.

---------- Forwarded message ---------
From: Gabriel <gabriel@example.com>
Date: Wed, Oct 14, 2026 at 4:00 PM
Subject: Cenová ponuka
To: Eva Tóthová <eva@ados.sk>


Posielam ponuku.

On Tue, Oct 13, 2026 at 10:00 AM Eva Tóthová <eva@ados.sk>
wrote:
> Pošlite ponuku.
`;

const outlook = `From: Eva Tóthová <eva@ados.sk>
Sent: 15. októbra 2026 9:12
To: Gabriel <mailto:gabriel@example.com>
Subject: Zmluva

Posielam zmluvu.

From: Gabriel <gabriel@example.com>
Sent: 14. októbra 2026 8:00
To: Eva Tóthová <eva@ados.sk>
Subject: Zmluva

Staršia správa.
`;

describe('reading a forwarded e-mail', () => {
  it('Gmail in Slovak: who, when, what, and only its own words', () => {
    const original = readForward({ text: gmailSk, html: null });
    expect(original).toMatchObject({
      from: 'Eva Tóthová <eva@ados.sk>',
      to: ['Gabriel <gabriel@example.com>'],
      cc: ['Marek <marek@ados.sk>', 'peter@ados.sk'],
      subject: 'Re: Cenová ponuka',
      text: 'Dobrý deň,\ns ponukou súhlasíme.\n\nS pozdravom, Eva',
    });
    expect(original!.date.toISOString()).toBe('2026-10-15T07:12:00.000Z');
  });

  it('Gmail in English, words above the block, the quote intro wrapped', () => {
    const original = readForward({ text: gmailEn, html: null });
    expect(original).toMatchObject({
      from: 'Gabriel <gabriel@example.com>',
      to: ['Eva Tóthová <eva@ados.sk>'],
      subject: 'Cenová ponuka',
      text: 'Posielam ponuku.',
    });
    expect(original!.date.toISOString()).toBe('2026-10-14T14:00:00.000Z');
  });

  it('Outlook has no marker; what it quotes under it is left out', () => {
    expect(readForward({ text: outlook, html: null })).toMatchObject({
      from: 'Eva Tóthová <eva@ados.sk>',
      to: ['Gabriel <gabriel@example.com>'],
      subject: 'Zmluva',
      text: 'Posielam zmluvu.',
    });
  });

  it('reads an e-mail with HTML only', () => {
    const html = gmailEn
      .split('\n')
      .map((line) => `<div>${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`)
      .join('');
    expect(readForward({ text: null, html })?.subject).toBe('Cenová ponuka');
  });

  it('reads the HTML when the text part has no block', () => {
    const html = `<div>---------- Forwarded message ---------<br>From: <b>Eva</b> <span>&lt;<a href="mailto:eva@ados.sk">eva@ados.sk</a>&gt;</span><br>Date: Wed, Oct 14, 2026 at 4:00 PM<br>Subject: Zmluva<br>To: &lt;info@alma-care.eu&gt;<br></div><br><div>Text.</div>`;
    expect(readForward({ text: 'Pozri', html })).toMatchObject({
      from: 'Eva <eva@ados.sk>',
      subject: 'Zmluva',
    });
  });

  it('nothing to read: no block, or no date', () => {
    expect(readForward({ text: 'Dobrý deň', html: null })).toBeNull();
    expect(readForward({ text: null, html: null })).toBeNull();
    expect(readForward({ text: gmailEn.replace(/Date:.*\n/, ''), html: null })).toBeNull();
  });

  it('the same original has one key, another reply another', () => {
    const one = readForward({ text: gmailSk, html: null })!;
    const again = readForward({ text: `${gmailSk}\n`, html: null })!;
    expect(importKey(one, 'eva@ados.sk')).toBe(importKey(again, 'eva@ados.sk'));
    expect(importKey({ ...one, text: 'Iná odpoveď' }, 'eva@ados.sk')).not.toBe(
      importKey(one, 'eva@ados.sk'),
    );
  });

  it('dates as the clients write them, in Bratislava time', () => {
    expect(parseForwardDate('1. 3. 2026 8:05')?.toISOString()).toBe('2026-03-01T07:05:00.000Z');
    expect(parseForwardDate('Thu, 15 Oct 2026 09:12:00 +0200')?.toISOString()).toBe(
      '2026-10-15T07:12:00.000Z',
    );
    expect(parseForwardDate('včera')).toBeNull();
  });
});
