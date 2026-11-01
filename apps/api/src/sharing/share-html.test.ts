import {
  applyChanges,
  documentStyles,
  fragmentForEditor,
  framePage,
  parseFragments,
  resolveChanges,
  sanitizeFragment,
} from './share-html.js';

const DOC = `<!doctype html><html><head><title>T</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree">
<meta http-equiv="refresh" content="0;url=https://evil.test">
<base href="https://evil.test/">
<style>.a{color:red}</style><script>window.keep=1</script></head>
<body class="x"><h1 class="a">Nadpis</h1>
<div class="card"><p style="color: red">Prvý <b>odsek</b></p><p>Druhý</p></div>
<table class="t"><tr><td>Bunka</td></tr></table>
<div class="note">Len text</div>
<svg width="10"><circle r="1"></circle></svg>
<img src="https://a.test/x.png" alt="x">
<p>Odkaz <a href="https://a.test" onclick="x()">tu</a></p>
<script id="alma-edit">bar()</script></body></html>`;

describe('parseFragments', () => {
  const fragments = parseFragments(DOC);
  const tags = fragments.map((f) => f.tag);

  it('numbers blocks in source order, with nothing inside a leaf', () => {
    expect(tags).toEqual(['h1', 'div', 'p', 'p', 'table', 'div', 'svg', 'img', 'p']);
    expect(fragments.map((f) => f.block)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ranges are the exact source', () => {
    expect(DOC.slice(fragments[0]!.start, fragments[0]!.end)).toBe('<h1 class="a">Nadpis</h1>');
    expect(fragments[2]!.parent).toBe(1);
  });

  it('offers editing only where the editor loses nothing', () => {
    const byBlock = (n: number) => fragments[n]!;
    expect(byBlock(0).editable).toBe(true);
    expect(byBlock(1).editable).toBe(false); // holds blocks
    expect(byBlock(4).editable).toBe(true); // the table
    expect(byBlock(5).editable).toBe(true); // a div of text
    expect(byBlock(6).editable).toBe(false); // svg
    expect(byBlock(7).editable).toBe(false); // img
    expect(byBlock(8).editable).toBe(false); // an event handler would be lost
  });
});

describe('sanitizeFragment', () => {
  const attacks: [string, string][] = [
    ['<p>a<script>alert(1)</script></p>', '<p>a</p>'],
    ['<p onclick="x()">a</p>', '<p>a</p>'],
    ['<a href="javascript:alert(1)">a</a>', '<a>a</a>'],
    ['<a href=" JaVaScRiPt:alert(1)">a</a>', '<a>a</a>'],
    ['<a href="data:text/html,x">a</a>', '<a>a</a>'],
    ['<a href="https://a.test" target="_top">a</a>', '<a href="https://a.test">a</a>'],
    ['<iframe src="https://e.test"></iframe>b', 'b'],
    ['<form action="https://e.test"><input name="x"></form>b', 'b'],
    ['<svg onload="x()"><script>y()</script></svg>b', 'b'],
    ['<math><mi>x</mi></math>b', 'b'],
    ['<style>*{display:none}</style>b', 'b'],
    ['<link rel="stylesheet" href="https://e.test/x.css">b', 'b'],
    ['<meta http-equiv="refresh" content="0">b', 'b'],
    ['<p style="background:url(https://e.test/x)">a</p>', '<p>a</p>'],
    ['<p style="position:fixed;top:0">a</p>', '<p>a</p>'],
    ['<p style="color:red;position:fixed">a</p>', '<p style="color:red">a</p>'],
    ['<p style="width:expression(alert(1))">a</p>', '<p>a</p>'],
    ['<custom-el onfoo="x">a<b>c</b></custom-el>', 'a<b>c</b>'],
    ['<!-- <script>x</script> -->a', 'a'],
    [
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>b',
      '<img src="x">"&gt;b',
    ],
    ['<template><script>x</script></template>b', 'b'],
    ['<p data-x="1" xlink:href="y">a</p>', '<p>a</p>'],
  ];
  it.each(attacks)('%s', (input, output) => {
    expect(sanitizeFragment(input)).toBe(output);
  });

  it('keeps what the editor writes and what the document had', () => {
    const html =
      '<table class="t"><tbody><tr><td colspan="2" style="color:red">a <strong>b</strong></td></tr></tbody></table>';
    expect(sanitizeFragment(html)).toBe(html);
  });

  it('takes pictures only from the fragment replaced', () => {
    const old = '<p><img src="https://a.test/x.png"></p>';
    expect(sanitizeFragment('<p><img src="https://a.test/x.png" onerror="x()"></p>', old)).toBe(
      '<p><img src="https://a.test/x.png"></p>',
    );
    expect(sanitizeFragment('<p><img src="https://e.test/track.png">a</p>', old)).toBe('<p>a</p>');
  });

  it('is stable on its own output', () => {
    for (const [input] of attacks) {
      const once = sanitizeFragment(input);
      expect(sanitizeFragment(once)).toBe(once);
    }
  });
});

describe('applyChanges', () => {
  it('leaves everything else byte for byte', () => {
    const fragments = parseFragments(DOC);
    const target = fragments[3]!;
    const out = applyChanges(DOC, [{ block: 3, html: '<p>Nový</p>' }]);
    expect(out).toBe(DOC.slice(0, target.start) + '<p>Nový</p>' + DOC.slice(target.end));
    expect(out).toContain('<script>window.keep=1</script>');
    expect(out).toContain('alma-edit');
  });

  it('deletes a fragment', () => {
    expect(applyChanges(DOC, [{ block: 0, html: null }])).not.toContain('Nadpis');
  });
});

describe('resolveChanges', () => {
  const source = '<body><p>A</p><p>B</p><div><p>C</p><p>D</p></div></body>';
  it('places a change by its original source, also in a newer version', () => {
    const newer = '<body><h2>Nové</h2><p>A</p><p>B</p><div><p>C</p><p>D</p></div></body>';
    const { placed, unplaced } = resolveChanges(newer, [
      { id: '1', oldHtml: '<p>B</p>', newHtml: '<p>B2</p>' },
    ]);
    expect(placed[0]!.block).toBe(2);
    expect(unplaced).toEqual([]);
  });
  it('a fragment that changed has no place', () => {
    const { placed, unplaced } = resolveChanges(source, [
      { id: '1', oldHtml: '<p>Stará</p>', newHtml: '<p>x</p>' },
    ]);
    expect(placed).toEqual([]);
    expect(unplaced.map((c) => c.id)).toEqual(['1']);
  });
  it('two changes of one fragment are alternatives on the same block', () => {
    const { placed } = resolveChanges(source, [
      { id: '1', oldHtml: '<p>A</p>', newHtml: '<p>A1</p>' },
      { id: '2', oldHtml: '<p>A</p>', newHtml: '<p>A2</p>' },
    ]);
    expect(placed.map((c) => c.block)).toEqual([0, 0]);
  });
  it('a change inside a deleted container has no place of its own', () => {
    const { placed, unplaced } = resolveChanges(source, [
      { id: '1', oldHtml: '<div><p>C</p><p>D</p></div>', newHtml: null },
      { id: '2', oldHtml: '<p>C</p>', newHtml: '<p>C2</p>' },
    ]);
    expect(placed.map((c) => c.id)).toEqual(['1']);
    expect(unplaced.map((c) => c.id)).toEqual(['2']);
  });
});

describe('framePage', () => {
  it('removes what must not show, keeps the rest for the sandbox, and numbers fragments', () => {
    const page = framePage(DOC, { mode: 'read' });
    expect(page).not.toContain('fonts.googleapis');
    expect(page).not.toContain('http-equiv');
    expect(page).not.toContain('<base');
    expect(page).not.toContain('alma-edit');
    expect(page).toContain('window.keep=1');
    expect(page).toContain('<h1 data-alma-b="0" data-alma-e="1" class="a">');
    expect(page.indexOf("MODE='read'")).toBeLessThan(page.indexOf('window.keep=1'));
  });

  it('shows changes in place, marked', () => {
    const page = framePage(DOC, {
      mode: 'draft',
      changes: [
        { id: 'c1', block: 0, html: '<h1 class="a">Nový</h1>' },
        { id: 'c2', block: 3, html: null },
      ],
    });
    expect(page).toContain('data-alma-change="c1"');
    expect(page).toContain('Nový');
    expect(page).toContain('data-alma-gone="c2"');
    expect(page).not.toContain('Druhý');
  });

  it('a document without a head gets the bridge too', () => {
    expect(framePage('<p>a</p>', { mode: 'read' })).toContain('MODE=');
  });
});

describe('the editor', () => {
  it('gets an editable fragment and the document styles', () => {
    expect(fragmentForEditor(DOC, 0)?.html).toBe('<h1 class="a">Nadpis</h1>');
    expect(fragmentForEditor(DOC, 6)).toBeNull();
    expect(documentStyles(DOC)).toContain('.a{color:red}');
  });
});
