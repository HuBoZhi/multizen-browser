import { useEffect, useState, type JSX, type ReactNode } from "react";
import {
  Boxes,
  Check,
  Chrome,
  Copy,
  DownloadCloud,
  Eye,
  EyeOff,
  Globe,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Pill } from "../atoms";
import { relativeTime } from "../../lib/relativeTime";
import { useI18n, type TFunc } from "../../lib/i18n";
import type {
  AppSettings,
  ChromiumStatus,
  EngineUpdateStatus,
  SystemInfo,
  UpdateStatus,
} from "../../types";

interface Props {
  onImport: () => void;
}

export function Settings({ onImport }: Props): JSX.Element {
  const { t, lang, setLang } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [tokenShown, setTokenShown] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<number>(0);
  const [chromiumStatus, setChromiumStatus] = useState<ChromiumStatus | null>(null);
  const [engineUpdateStatus, setEngineUpdateStatus] = useState<EngineUpdateStatus | null>(null);

  useEffect(() => {
    if (!window.multizen) return;
    void window.multizen.settings.get().then(setSettings);
    void window.multizen.system.info().then(setInfo);
    void window.multizen.update.status().then(setUpdateStatus);
    void window.multizen.update.lastChecked().then(setLastChecked);
    void window.multizen.chromium.status().then(setChromiumStatus);
    void window.multizen.engineUpdate.status().then(setEngineUpdateStatus);
    const offChromium = window.multizen.chromium.onStatus(setChromiumStatus);
    const offEngineUpdate = window.multizen.engineUpdate.onStatus(setEngineUpdateStatus);
    // Refresh "last checked" on every status change too, so a background
    // auto-check updates the label live while Settings is open.
    const offUpdate = window.multizen.update.onStatus((s) => {
      setUpdateStatus(s);
      void window.multizen.update.lastChecked().then(setLastChecked);
    });
    return () => {
      offChromium();
      offEngineUpdate();
      offUpdate();
    };
  }, []);

  async function patch(p: Partial<AppSettings>): Promise<void> {
    if (!settings) return;
    const next = await window.multizen.settings.update(p);
    setSettings(next);
  }

  async function checkForUpdates(): Promise<void> {
    await window.multizen.update.check();
    setLastChecked(await window.multizen.update.lastChecked());
  }

  async function checkEngineForUpdates(): Promise<void> {
    // install() = check + stage the newer version (applies on next launch).
    setEngineUpdateStatus(await window.multizen.engineUpdate.install());
  }

  function copyMcpUrl(): void {
    if (!info?.mcpHttpUrl) return;
    navigator.clipboard.writeText(info.mcpHttpUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function copyMcpToken(): void {
    if (!info?.mcpAuthToken) return;
    navigator.clipboard.writeText(info.mcpAuthToken);
    setTokenCopied(true);
    window.setTimeout(() => setTokenCopied(false), 1500);
  }

  if (!settings) {
    return (
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-[720px] mx-auto text-[13px] text-neutral-400">{t("Loading…")}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto" style={{ padding: "24px 32px" }}>
      <div className="max-w-[720px] mx-auto">
        <div className="text-lg font-bold tracking-tight text-neutral-100 mb-1.5">{t("Settings")}</div>
        <div className="text-[13px] text-neutral-400 mb-5">
          {t(
            "MCP server, archives, build info. Configuration is local — MultiZen does not call any external API on your behalf.",
          )}
        </div>

        <Row
          icon={<Globe size={16} strokeWidth={1.5} />}
          title={t("Language")}
          desc={t("Display language for the MultiZen interface. Applies immediately.")}
        >
          <div className="flex gap-2">
            {(
              [
                { code: "en", label: "English" },
                { code: "zh", label: "简体中文" },
              ] as Array<{ code: typeof lang; label: string }>
            ).map((option) => {
              const selected = lang === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setLang(option.code)}
                  className="text-left px-4 py-2 rounded-lg transition-colors text-[13px] font-medium"
                  style={{
                    boxShadow: selected
                      ? "inset 0 0 0 1px rgba(255,255,255,0.45)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.07)",
                    background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                    color: selected ? "#e5e5e5" : "#a3a3a3",
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </Row>

        <Row
          icon={<Zap size={16} strokeWidth={1.5} />}
          title={t("MCP server")}
          desc={t(
            "Local HTTP transport that Cursor / Claude Desktop / Cline / any MCP client connects to. Requires the auth token below. The MCP tab has ready-to-paste client configs.",
          )}
        >
          <div className="flex gap-2 items-center flex-wrap">
            <Pill kind={info?.mcpHttpUrl ? "running" : "idle"} dot={!!info?.mcpHttpUrl}>
              {info?.mcpHttpUrl ? t("running on :{port}", { port: settings.mcpHttpPort }) : t("off")}
            </Pill>

            {info?.mcpHttpUrl && (
              <div
                className="flex-1 min-w-[260px] flex items-center gap-2"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.19)",
                }}
              >
                <span className="flex-1 mono text-[12px] text-neutral-300 truncate">
                  {info.mcpHttpUrl}
                </span>
                <button
                  type="button"
                  onClick={copyMcpUrl}
                  className="text-neutral-300 hover:text-neutral-200 transition-colors"
                  aria-label={t("Copy URL")}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            )}
          </div>

          {info?.mcpAuthToken && (
            <div className="mt-2">
              <div className="text-[11px] text-neutral-400 mb-1">
                {t("Auth token — required. Send as")}{" "}
                <span className="mono text-neutral-400">Authorization: Bearer &lt;token&gt;</span>.{" "}
                {t("Keep it secret.")}
              </div>
              <div
                className="flex items-center gap-2"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.19)",
                }}
              >
                <span className="flex-1 mono text-[12px] text-neutral-300 truncate">
                  {tokenShown ? info.mcpAuthToken : "•".repeat(24)}
                </span>
                <button
                  type="button"
                  onClick={() => setTokenShown((v) => !v)}
                  className="text-neutral-400 hover:text-neutral-200 transition-colors"
                  aria-label={tokenShown ? t("Hide token") : t("Reveal token")}
                >
                  {tokenShown ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  onClick={copyMcpToken}
                  className="text-neutral-300 hover:text-neutral-200 transition-colors"
                  aria-label={t("Copy token")}
                >
                  {tokenCopied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2.5 mt-3 text-[12px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.mcpHttpEnabled}
              onChange={(e) => void patch({ mcpHttpEnabled: e.target.checked })}
              className="w-3.5 h-3.5 rounded accent-neutral-300"
            />
            {t("Auto-start MCP HTTP transport on app launch")}
          </label>
        </Row>

        <Row
          icon={<Chrome size={16} strokeWidth={1.5} />}
          title={t("Browser engine")}
          desc={t("Applied on next app launch.")}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {engineOptions.map((option) => {
              const selected = settings.browserEngine === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void patch({ browserEngine: option.value })}
                  className="text-left p-3 rounded-lg transition-colors"
                  style={{
                    boxShadow: selected
                      ? "inset 0 0 0 1px rgba(255,255,255,0.45)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.07)",
                    background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-neutral-100">{option.label}</span>
                    {selected && <Pill kind="running">{t("active")}</Pill>}
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                    {t(option.description)}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2.5 flex-wrap">
            <span className="text-[12px] text-neutral-400">
              {chromiumStatus?.kind === "ready"
                ? t("Installed: v{version}", { version: chromiumStatus.version })
                : t("Engine not downloaded yet")}
            </span>
            <button
              type="button"
              className="btn-secondary px-3 py-[7px] text-[12px] rounded-[9px] inline-flex items-center gap-1.5"
              onClick={() => void checkEngineForUpdates()}
              disabled={
                engineUpdateStatus?.kind === "checking" ||
                engineUpdateStatus?.kind === "downloading"
              }
            >
              <RefreshCw
                size={12}
                className={
                  engineUpdateStatus?.kind === "checking" ||
                  engineUpdateStatus?.kind === "downloading"
                    ? "animate-spin"
                    : ""
                }
              />
              {t("Check for updates")}
            </button>
            <span className="text-[12px] text-neutral-400">
              {engineUpdateLabel(engineUpdateStatus, t)}
            </span>
          </div>
          <label className="flex items-center gap-2.5 mt-3 text-[12px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.engineAutoUpdate}
              onChange={(e) => void patch({ engineAutoUpdate: e.target.checked })}
              className="w-3.5 h-3.5 rounded accent-neutral-300"
            />
            {t("Automatically keep the browser engine up to date")}
          </label>
        </Row>

        <Row
          icon={<Boxes size={16} strokeWidth={1.5} />}
          title={t("Archives")}
          desc={t(
            ".mzar files are encrypted bundles of profiles — cookies, login state, fingerprints, notes — protected with a passphrase you set at export time.",
          )}
        >
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-[7px] text-[12px] rounded-[9px]"
              onClick={onImport}
            >
              {t("Import .mzar archive")}
            </button>
            <a
              href="https://github.com/multizenteam/multizen-browser#archives"
              target="_blank"
              rel="noopener"
              className="btn-ghost px-3 py-[7px] text-[12px] rounded-[9px]"
            >
              {t("Read archive format docs")}
            </a>
          </div>
        </Row>

        <Row
          icon={<DownloadCloud size={16} strokeWidth={1.5} />}
          title={t("Updates")}
          desc={
            info?.platform === "darwin"
              ? t(
                  "Auto-install isn't available on macOS yet — we'll notify you in-app to download the new version.",
                )
              : t("MultiZen checks for updates in the background and installs them on restart.")
          }
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              className="btn-secondary px-3 py-[7px] text-[12px] rounded-[9px] inline-flex items-center gap-1.5"
              onClick={() => void checkForUpdates()}
              disabled={updateStatus?.kind === "checking"}
            >
              <RefreshCw
                size={12}
                className={updateStatus?.kind === "checking" ? "animate-spin" : ""}
              />
              {t("Check for updates")}
            </button>
            <span className="text-[12px] text-neutral-400">{updateLabel(updateStatus, t)}</span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-2">
            {t("Last checked: {time}", {
              time: lastChecked ? relativeTime(new Date(lastChecked).toISOString()) : t("never"),
            })}
          </div>
          <label className="flex items-center gap-2.5 mt-3 text-[12px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoUpdate}
              onChange={(e) => void patch({ autoUpdate: e.target.checked })}
              className="w-3.5 h-3.5 rounded accent-neutral-300"
            />
            {t("Automatically check for updates")}
          </label>
        </Row>

        <Row
          icon={<ShieldCheck size={16} strokeWidth={1.5} />}
          title={t("Anonymous usage")}
          desc={t("Off by default. Help gauge how many people run MultiZen.")}
        >
          <label className="flex items-center gap-2.5 text-[12px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.usageReporting}
              onChange={(e) => void patch({ usageReporting: e.target.checked })}
              className="w-3.5 h-3.5 rounded accent-neutral-300"
            />
            {t("Send an anonymous daily heartbeat")}
          </label>
          <div className="text-[11px] text-neutral-400 mt-2 leading-relaxed">
            {t(
              "When on, sends once a day: app version, OS family, and a random single-use token — no account, no persistent ID, and your IP is never stored (a coarse country is derived server-side then discarded). No profiles, proxies, or browsing are ever included. Set",
            )}{" "}
            <code className="text-neutral-400">MULTIZEN_NO_TELEMETRY=1</code>{" "}
            {t("to force it off.")}
          </div>
        </Row>

        <Row icon={<Sparkles size={16} strokeWidth={1.5} />} title={t("About")} desc="">
          <div className="mono text-[12px] text-neutral-400 leading-relaxed">
            MultiZen v{info?.appVersion ?? "0.0.0"} · {info?.platform ?? "—"} · Electron{" "}
            {electronVersion()}
          </div>
        </Row>
      </div>
    </div>
  );
}

const engineOptions: Array<{
  value: AppSettings["browserEngine"];
  label: string;
  description: string;
}> = [
  {
    value: "cloakbrowser",
    label: "CloakBrowser",
    description: "Source-patched Chromium from CloakHQ releases. Primary runtime.",
  },
  {
    value: "cft",
    label: "Chrome for Testing",
    description: "Compatibility fallback using Google's official automation build.",
  },
];

function electronVersion(): string {
  // Vite injects nothing useful here; just use a stable string for now.
  return "33";
}

function updateLabel(status: UpdateStatus | null, t: TFunc): string {
  switch (status?.kind) {
    case "checking":
      return t("Checking…");
    case "up-to-date":
      return t("You're on the latest version");
    case "available":
      return t("v{version} available", { version: status.version });
    case "downloading":
      return t("Downloading v{version}… {percent}%", {
        version: status.version,
        percent: status.percent,
      });
    case "ready":
      return t("v{version} ready — restart to update", { version: status.version });
    case "error":
      return t("Check failed: {message}", { message: status.message });
    default:
      return "";
  }
}

function engineUpdateLabel(status: EngineUpdateStatus | null, t: TFunc): string {
  switch (status?.kind) {
    case "checking":
      return t("Checking…");
    case "up-to-date":
      return t("Engine is up to date");
    case "available":
      return t("v{version} available", { version: status.version });
    case "downloading": {
      const pct =
        status.bytesTotal > 0
          ? Math.round((status.bytesReceived / status.bytesTotal) * 100)
          : 0;
      return t("Downloading v{version}… {percent}%", { version: status.version, percent: pct });
    }
    case "staged":
      return t("v{version} will apply next time you launch a profile", { version: status.version });
    case "error":
      return t("Check failed: {message}", { message: status.message });
    default:
      return "";
  }
}

function Row({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="flex items-start gap-3.5"
      style={{
        padding: "16px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "rgba(255,255,255,0.10)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
          color: "#e5e5e5",
        }}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-neutral-100">{title}</div>
        {desc && (
          <div className="text-[12px] text-neutral-400 mt-1 leading-relaxed max-w-[480px]">
            {desc}
          </div>
        )}
        {children && <div className="mt-2.5">{children}</div>}
      </div>
    </div>
  );
}
