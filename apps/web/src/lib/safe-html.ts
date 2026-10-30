/**
 * Untrusted HTML as a document of its own, for a frame without scripts: its CSP lets nothing load
 * from outside (no tracking pixels, no remote fonts or styles), only what the document carries.
 */
export const safeDocument = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` +
  `<style>body{margin:16px;font:14px/1.5 system-ui,sans-serif;color:#1b2424;overflow-wrap:anywhere}</style>` +
  `</head><body>${html}</body></html>`;
