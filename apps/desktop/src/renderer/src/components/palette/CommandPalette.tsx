import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { Boxes, Command, Download, Play, Plug, Plus, Settings as SettingsIcon } from "lucide-react";
import type { ProfileSummary } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Kbd } from "../atoms";

export type CommandAction =
  | { kind: "launch"; profileId: string }
  | { kind: "open"; profileId: string }
  | { kind: "create" }
  | { kind: "import" }
  | { kind: "export" }
  | { kind: "settings" }
  | { kind: "section"; id: "profiles" | "mcp" | "settings" };

interface Props {
  open: boolean;
  profiles: ProfileSummary[];
  onClose: () => void;
  onAction: (a: CommandAction) => void;
}

interface Row {
  id: string;
  icon: ReactNode;
  title: ReactNode;
  sub?: string;
  kbd?: ReactNode;
  group: string;
  action: CommandAction;
}

export function CommandPalette({ open, profiles, onClose, onAction }: Props): JSX.Element | null {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const profileRows: Row[] = profiles.flatMap((p) => {
      const text = `${p.name} ${p.tags.join(" ")} ${p.id}`.toLowerCase();
      if (q && !text.includes(q)) return [];
      const launchRow: Row = {
        id: `launch:${p.id}`,
        icon: <Play size={14} strokeWidth={1.5} className="text-current" />,
        title: <>{p.isRunning ? t("Open") : t("Launch")} · {p.name}</>,
        sub: `${p.id.slice(0, 12)} · ${p.tags.join(", ") || t("no tags")}`,
        group: "Profiles",
        action: { kind: p.isRunning ? "open" : "launch", profileId: p.id },
      };
      return [launchRow];
    });

    const actionRows: Row[] = [
      {
        id: "create",
        icon: <Plus size={14} strokeWidth={1.5} />,
        title: q ? <>{t("Create new profile")} · "<span className="mono text-neutral-200">{query}</span>"</> : t("Create new profile"),
        kbd: <Kbd>⌘ N</Kbd>,
        group: "Actions",
        action: { kind: "create" },
      },
      {
        id: "import",
        icon: <Download size={14} strokeWidth={1.5} />,
        title: t("Import .mzar archive"),
        group: "Actions",
        action: { kind: "import" },
      },
      {
        id: "section:profiles",
        icon: <Boxes size={14} strokeWidth={1.5} />,
        title: t("Go to Profiles"),
        kbd: <Kbd>⌘ 1</Kbd>,
        group: "Navigate",
        action: { kind: "section", id: "profiles" },
      },
      {
        id: "section:mcp",
        icon: <Plug size={14} strokeWidth={1.5} />,
        title: t("Go to MCP"),
        kbd: <Kbd>⌘ 2</Kbd>,
        group: "Navigate",
        action: { kind: "section", id: "mcp" },
      },
      {
        id: "settings",
        icon: <SettingsIcon size={14} strokeWidth={1.5} />,
        title: t("Settings"),
        kbd: <Kbd>⌘ ,</Kbd>,
        group: "Navigate",
        action: { kind: "settings" },
      },
    ];

    if (q) {
      const filteredActions = actionRows.filter((r) => String(r.title).toString().toLowerCase().includes(q) || r.id === "create");
      return [...profileRows, ...filteredActions];
    }
    return [...profileRows.slice(0, 6), ...actionRows];
  }, [profiles, query, t]);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      const list = map.get(r.group) ?? [];
      list.push(r);
      map.set(r.group, list);
    });
    return map;
  }, [rows]);

  // Clamp activeIdx
  useEffect(() => {
    if (activeIdx >= rows.length) setActiveIdx(Math.max(0, rows.length - 1));
  }, [rows.length, activeIdx]);

  function handleKey(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) {
        onAction(row.action);
        onClose();
      }
    }
  }

  if (!open) return null;

  let runningIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[80px]"
      style={{
        background: "rgba(5,6,10,0.55)",
        backdropFilter: "blur(8px)",
        animation: "mz-fade-in 120ms ease-out",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 600,
          borderRadius: 16,
          background: "rgba(23,23,23,0.92)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.17), 0 30px 80px rgba(0,0,0,0.6)",
          backdropFilter: "blur(24px)",
          overflow: "hidden",
          animation: "mz-slide-up 140ms cubic-bezier(0.2,0.8,0.2,1)",
        }}
        onKeyDown={handleKey}
      >
        {/* Input */}
        <div
          className="flex items-center gap-3 px-[18px] py-3.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Command size={16} className="text-neutral-300" strokeWidth={1.5} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search profiles, tags, actions…")}
            className="flex-1 bg-transparent outline-none text-[14px] text-neutral-100 placeholder:text-neutral-400"
          />
          <Kbd>esc</Kbd>
        </div>

        {/* Rows */}
        <div className="max-h-[420px] overflow-auto">
          {[...grouped.entries()].map(([group, groupRows]) => (
            <div key={group}>
              <div
                className="uppercase tracking-wider text-neutral-400"
                style={{
                  padding: "8px 18px 4px",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                }}
              >
                {t(group)} · {groupRows.length} {groupRows.length === 1 ? t("match") : t("matches")}
              </div>
              {groupRows.map((row) => {
                const idx = runningIdx++;
                const isActive = idx === activeIdx;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      onAction(row.action);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 text-left"
                    style={{
                      padding: "9px 18px",
                      background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
                      boxShadow: isActive ? "inset 2px 0 0 #e5e5e5" : undefined,
                      border: 0,
                      cursor: "pointer",
                      color: isActive ? "#e5e5e5" : "#737373",
                    }}
                  >
                    {row.icon}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[13px] font-medium leading-tight"
                        style={{ color: isActive ? "#e5e5e5" : "#d4d4d4" }}
                      >
                        {row.title}
                      </div>
                      {row.sub && <div className="mono text-[10px] text-neutral-400 mt-[3px] truncate">{row.sub}</div>}
                    </div>
                    {row.kbd}
                  </button>
                );
              })}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-6 py-10 text-center text-[12px] text-neutral-400">
              {t("No matches. Press")} <Kbd>⌘ N</Kbd> {t("to create a new profile.")}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-3 px-[18px] py-2 text-[11px] text-neutral-400"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
        >
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {t("navigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>⏎</Kbd> {t("select")}
          </span>
          <span className="flex-1" />
          <span className="mono">{t("{count} commands", { count: rows.length })}</span>
        </div>
      </div>
    </div>
  );
}
