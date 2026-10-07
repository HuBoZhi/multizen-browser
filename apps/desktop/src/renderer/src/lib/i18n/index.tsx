import { createContext, useContext, useEffect, useMemo, type JSX, type ReactNode } from "react";
import { usePersistedState } from "../persisted";
import { setFormattingLocale } from "../relativeTime";
import { ZH } from "./zh";

export type Lang = "en" | "zh";

/**
 * Translate a user-facing string. Keys are the English source copy itself
 * (gettext-style), so `t("Settings")` renders "Settings" in English and the
 * zh dictionary's entry in Chinese. Missing entries fall back to the key.
 *
 * Interpolation: `t("Launch failed: {message}", { message })` — `{name}`
 * placeholders are replaced from `params`; unknown placeholders stay as-is.
 */
export type TFunc = (key: string, params?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18n>({ lang: "en", setLang: () => {}, t: (k) => k });

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/** First-run default: follow the OS language when it's Chinese, else English. */
function detectLang(): Lang {
  try {
    return (navigator.language ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  // Persisted under localStorage `multizen.ui.lang` like the other UI state.
  const [lang, setLang] = usePersistedState<Lang>("lang", detectLang());

  // Keep plain (non-React) formatters — relative time, dates — in sync, and
  // tell the main process so native dialogs (import/export pickers, the
  // companion confirm) follow the same language.
  useEffect(() => {
    setFormattingLocale(lang === "zh" ? "zh-CN" : "en");
    window.multizen?.system.setLang(lang);
  }, [lang]);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => {
        const template = lang === "zh" ? (ZH[key] ?? key) : key;
        return interpolate(template, params);
      },
    }),
    [lang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
