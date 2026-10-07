import { app } from "electron";

/**
 * UI language for user-facing native dialogs (import/export pickers, the
 * companion "Add to MultiZen" confirm). The renderer pushes the chosen
 * language over IPC (`ui:lang`); until then we follow the OS locale.
 * Startup/CLI error dialogs stay English — they can fire before any window
 * exists and read as technical output.
 */
let lang = (app.getLocale?.() ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";

export function setUiLang(next: unknown): void {
  if (next === "zh" || next === "en") lang = next;
}

/** Translate by pair: returns the zh or en variant per the current UI language. */
export function tt(en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}
