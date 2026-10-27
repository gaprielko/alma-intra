/** Hands the browser a file to save, made here (a CSV export), without a round trip to a URL. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // After the click has handed the file over; revoking at once can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `zakaznici-2026-10-27.csv` */
export const datedFilename = (base: string, extension: string, now = new Date()) =>
  `${base}-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.${extension}`;
