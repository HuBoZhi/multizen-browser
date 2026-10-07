// Locale for relative/time formatting, set by the I18nProvider on language
// change so plain (non-React) call sites localize without prop drilling.
let locale = "en";

export function setFormattingLocale(next: string): void {
  locale = next;
}

const isZh = (): boolean => locale.startsWith("zh");

export function relativeTime(iso: string | undefined): string {
  if (!iso) return isZh() ? "从未" : "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return isZh() ? "从未" : "never";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return isZh() ? "刚刚" : "just now";
  const s = Math.floor(diff / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (s < 60) return rtf.format(-s, "second");
  const m = Math.floor(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const days = Math.floor(h / 24);
  if (days < 30) return rtf.format(-days, "day");
  return d.toLocaleDateString(locale);
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(locale, { hour12: false });
}
