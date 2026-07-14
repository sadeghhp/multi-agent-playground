/** Trigger a client-side download of a JSON string as a file. */
export function downloadJson(filename: string, json: string): void {
  const safe = filename.replace(/[^\w.-]+/g, '_') || 'download';
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe.endsWith('.json') ? safe : `${safe}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
