import { useMemo, type JSX } from "react";
import { Activity as ActivityIcon, ChevronUp, ChevronDown } from "lucide-react";
import type { ActivityEvent, ProfileSummary } from "../../types";
import { Pill, Kbd, Flag, ccFromTimezone } from "../atoms";
import { formatTime } from "../../lib/relativeTime";
import { useI18n } from "../../lib/i18n";

interface Props {
  open: boolean;
  events: ActivityEvent[];
  profiles: ProfileSummary[];
  onToggle: () => void;
}

export function ActivityDrawer({ open, events, profiles, onToggle }: Props): JSX.Element {
  const { t } = useI18n();
  const liveCount = useMemo(() => events.filter((e) => e.status === "pending").length, [events]);
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const recent = useMemo(() => events.slice(-150).reverse(), [events]);

  return (
    <div
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{
        height: open ? 240 : 36,
        background: "rgba(23,23,23,0.85)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        backdropFilter: "blur(20px)",
        transition: "height 220ms cubic-bezier(0.2,0.8,0.2,1)",
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2.5 flex-shrink-0 cursor-pointer text-left w-full"
        style={{
          height: 36,
          padding: "0 18px",
          borderBottom: open ? "1px solid rgba(255,255,255,0.05)" : "none",
          background: "transparent",
          border: 0,
        }}
      >
        <ActivityIcon size={13} className="text-neutral-300" />
        <span className="text-[12px] font-semibold text-neutral-100">{t("MCP activity")}</span>
        {liveCount > 0 ? (
          <Pill kind="ai" dot>{t("{count} live", { count: liveCount })}</Pill>
        ) : (
          <Pill kind="idle">{t("{count} calls", { count: events.length })}</Pill>
        )}
        <span className="mono text-[10px] text-neutral-400">{t("last 5 min")}</span>
        <div className="flex-1" />
        <Kbd>⌘ ⇧ A</Kbd>
        {open ? (
          <ChevronDown size={13} className="text-neutral-400" />
        ) : (
          <ChevronUp size={13} className="text-neutral-400" />
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="flex-1 overflow-auto">
          {recent.length === 0 ? (
            <div className="px-6 py-12 text-center text-[12px] text-neutral-400">
              {t("No MCP calls yet. Connect an agent (see the MCP tab) and its tool calls stream here.")}
            </div>
          ) : (
            <>
              <div
                className="grid mono uppercase text-neutral-400 sticky top-0"
                style={{
                  gridTemplateColumns: "70px 140px 1fr 70px 80px",
                  gap: 12,
                  padding: "6px 18px",
                  fontSize: 9,
                  letterSpacing: "0.08em",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: "rgba(23,23,23,0.95)",
                }}
              >
                <div>{t("Time")}</div>
                <div>{t("Tool")}</div>
                <div>{t("Summary")}</div>
                <div>{t("Dur")}</div>
                <div className="text-right">{t("Status")}</div>
              </div>
              {recent.map((e) => (
                <Row key={e.id} event={e} profile={e.profileId ? profilesById.get(e.profileId) : undefined} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ event, profile }: { event: ActivityEvent; profile?: ProfileSummary }): JSX.Element {
  const { t } = useI18n();
  const cc = profile ? ccFromTimezone((profile as ProfileSummary).tags.find((t) => t.startsWith("tz:"))?.slice(3)) : undefined;

  const argsLine = useMemo(() => {
    const entries = Object.entries(event.args).filter(([k]) => k !== "profile_id");
    if (entries.length === 0) return null;
    return entries
      .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : String(v)}`)
      .join(" ")
      .slice(0, 120);
  }, [event.args]);

  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: "70px 140px 1fr 70px 80px",
        gap: 12,
        padding: "8px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        background: event.status === "pending" ? "rgba(255,255,255,0.04)" : undefined,
      }}
    >
      <div className="mono text-[11px] text-neutral-400">{formatTime(event.timestamp)}</div>
      <div className="mono text-[12px] text-neutral-300 truncate">
        <span className="text-neutral-300">multizen.</span>
        {event.tool}
      </div>
      <div className="flex flex-col gap-[2px] min-w-0">
        <div className="text-[12px] text-neutral-300 truncate">{event.summary ?? argsLine ?? "—"}</div>
        {profile && (
          <div className="mono text-[10px] text-neutral-400 flex items-center gap-1.5 truncate">
            <Flag cc={cc} />
            {profile.name} · {profile.id.slice(0, 10)}
          </div>
        )}
      </div>
      <div className="mono text-[11px] text-neutral-400">
        {event.durationMs !== undefined ? `${event.durationMs}ms` : "—"}
      </div>
      <div className="text-right">
        {event.status === "ok" && <Pill kind="running">{t("ok")}</Pill>}
        {event.status === "pending" && <Pill kind="ai" dot>{t("live")}</Pill>}
        {event.status === "error" && <Pill kind="error">{t("error")}</Pill>}
      </div>
    </div>
  );
}
