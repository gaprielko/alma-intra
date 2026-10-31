const shell = (policy: string, style: string, html: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
  `<meta name="referrer" content="no-referrer">` +
  `<style>${style}</style>` +
  `</head><body>${html}</body></html>`;

const BODY =
  'body{margin:16px;font:14px/1.5 system-ui,sans-serif;color:#1b2424;overflow-wrap:anywhere}';

/**
 * Untrusted HTML as a document of its own, for a frame without scripts: its CSP lets nothing load
 * from outside (no tracking pixels, no remote fonts or styles), only what the document carries.
 */
export const safeDocument = (html: string) =>
  shell("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:", BODY, html);

/** A colleague's document in Files: as above, but its pictures show, also from the internet. */
const filePolicy =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:";

export const fileDocument = (html: string) => shell(filePolicy, BODY, html);

/** What a converted Markdown file looks like: a page to read, not a bare e-mail body. */
const MARKDOWN_STYLE = `${BODY}
body{max-width:52rem;margin:0 auto;padding:32px 24px 56px;font-size:15px;line-height:1.6}
h1,h2,h3,h4{line-height:1.25;margin:1.5em 0 .5em}h1{font-size:1.9em;margin-top:0}h2{font-size:1.45em}h3{font-size:1.15em}
p,ul,ol,table,pre,blockquote{margin:0 0 1em}li{margin:.2em 0}a{color:#0a6466}img{max-width:100%}
code{font:.9em ui-monospace,Menlo,Consolas,monospace;background:#f1f5f4;border-radius:4px;padding:.1em .35em}
pre{background:#f1f5f4;border-radius:8px;padding:12px 14px;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid #dfe8e6;padding:6px 10px;text-align:left}th{background:#f7faf9}
blockquote{border-left:3px solid #dfe8e6;margin-left:0;padding-left:14px;color:#48625f}hr{border:0;border-top:1px solid #dfe8e6;margin:1.5em 0}`;

/** A Markdown file already converted to HTML: anything raw in it stays in the same scriptless frame. */
export const markdownDocument = (html: string) => shell(filePolicy, MARKDOWN_STYLE, html);
