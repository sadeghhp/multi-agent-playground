/** Trigger a client-side download of `content` as a file with the given extension. */
export function downloadText(
  filename: string,
  content: string,
  ext: string,
  mime: string,
): void {
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'download';
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger a client-side download of a JSON string as a file. */
export function downloadJson(filename: string, json: string): void {
  downloadText(filename, json, 'json', 'application/json');
}
