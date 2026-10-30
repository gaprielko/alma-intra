import { describe, expect, it } from 'vitest';
import { importKey, parseForwardDate, readForward } from './forwarded.js';

const gmailSk = `Alma Intra: add mail

---------- Preposlaná správa ---------
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

const gmailEn = `alma intra: ADD MAIL

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

const outlook = `Alma Intra: add mail

From: Eva Tóthová <eva@ados.sk>
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
    const { asked, original } = readForward({ text: gmailSk, html: null });
    expect(asked).toBe(true);
    expect(original).toMatchObject({
      from: 'Eva Tóthová <eva@ados.sk>',
      to: ['Gabriel <gabriel@example.com>'],
      cc: ['Marek <marek@ados.sk>', 'peter@ados.sk'],
      subject: 'Re: Cenová ponuka',
      text: 'Dobrý deň,\ns ponukou súhlasíme.\n\nS pozdravom, Eva',
    });
    expect(original!.date.toISOString()).toBe('2026-10-15T07:12:00.000Z');
  });

  it('Gmail in English, the line in any case, the quote intro wrapped', () => {
    const { original } = readForward({ text: gmailEn, html: null });
    expect(original).toMatchObject({
      from: 'Gabriel <gabriel@example.com>',
      to: ['Eva Tóthová <eva@ados.sk>'],
      subject: 'Cenová ponuka',
      text: 'Posielam ponuku.',
    });
    expect(original!.date.toISOString()).toBe('2026-10-14T14:00:00.000Z');
  });

  it('Outlook has no marker; what it quotes under it is left out', () => {
    const { original } = readForward({ text: outlook, html: null });
    expect(original).toMatchObject({
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
    expect(readForward({ text: null, html }).original?.subject).toBe('Cenová ponuka');
  });

  it('does nothing without the agreed line, even in the quoted part', () => {
    expect(readForward({ text: 'Dobrý deň', html: null }).asked).toBe(false);
    const quoted = gmailEn
      .replace('alma intra: ADD MAIL', 'Pozri')
      .replace('Posielam', 'Alma Intra: add mail');
    expect(readForward({ text: quoted, html: null }).asked).toBe(false);
  });

  it('asked, but without a readable original: nothing to import', () => {
    expect(readForward({ text: 'Alma Intra: add mail', html: null })).toEqual({
      asked: true,
      original: null,
    });
    const noDate = gmailEn.replace(/Date:.*\n/, '');
    expect(readForward({ text: noDate, html: null }).original).toBeNull();
  });

  it('the same original has one key, another reply another', () => {
    const one = readForward({ text: gmailSk, html: null }).original!;
    const again = readForward({ text: `${gmailSk}\n`, html: null }).original!;
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
