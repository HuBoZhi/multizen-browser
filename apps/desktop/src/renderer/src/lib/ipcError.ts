/**
 * ipcRenderer.invoke() rejections arrive wrapped as
 * `Error invoking remote method '<channel>': Error: <original message>` —
 * the wrapper is Electron plumbing the user never needs to see. Strip it so
 * toasts surface the handler's (already localized) message alone.
 */
export function ipcErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}
