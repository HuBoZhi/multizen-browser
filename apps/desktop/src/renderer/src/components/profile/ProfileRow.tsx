import { useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Loader2, MoreHorizontal, Play, Plus, RefreshCw, Square, Zap } from "lucide-react";
import type { RunInfo } from "@multizen/types";
import {
  Avatar,
  Flag,
  PlatformIcon,
  Pill,
  countryNameFromCc,
  platformFromDeviceFamily,
  platformLabel,
} from "../atoms";
import { Button } from "../atoms/Button";
import { relativeTime } from "../../lib/relativeTime";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { profileEmoji } from "../../lib/profileEmoji";
import { emojiTint } from "../../lib/emojiTint";
import { useProxyHealth } from "../../lib/proxyHealth";
import type { TileData, TileState } from "./ProfileTile";
import { PROFILE_TABLE_GRID_TEMPLATE } from "./ProfileTable";

const STATE_RING_COLOR: Record<TileState, string> = {
  idle: "rgba(163,163,163,0.3)",      // neutral
  running: "rgba(52,211,153,0.6)",    // emerald
  ai: "rgba(229,229,229,0.6)",        // neutral
  error: "rgba(248,113,113,0.6)",     // red
};

interface Props {
  profile: TileData;
  /** This profile's live browser instances (run model). */
  runs?: RunInfo[];
  /** Chromium winding down (window closed / Stop) but not yet exited. */
  terminating?: boolean;
  onOpen: () => void;
  onLaunch: () => Promise<void> | void;
  /** Launch ONE MORE instance (run 2+ executes on a disposable copy). */
  onNewInstance: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
  onExport: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** A dense row equivalent of <ProfileTile />. Same data, same handlers. */
export function ProfileRow({
  profile,
  runs,
  terminating = false,
  onOpen,
  onLaunch,
  onNewInstance,
  onStop,
  onExport,
  onDuplicate,
  onDelete,
}: Props): JSX.Element {
  const { t } = useI18n();
  const isRunning = profile.state !== "idle";
  const liveRuns = runs ?? [];
  const showTerminating = terminating && liveRuns.length === 0;
  // Emoji avatar (parity with the grid card): user's custom `icon` if set, else
  // a classifier-derived default from name/tags/id, on a deterministic tint.
  const emoji = profileEmoji(profile.icon, profile.name, profile.tags, profile.id);
  const avatarTint = emojiTint(emoji);

  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [profile.isRunning]);

  async function handleLaunch(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await onLaunch();
    } catch {
      setPending(false);
    }
    window.setTimeout(() => setPending(false), 5000);
  }

  async function handleNewInstance(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await onNewInstance();
    } catch {
      setPending(false);
    }
    window.setTimeout(() => setPending(false), 5000);
  }

  async function handleStop(e: React.MouseEvent): Promise<void> {
    e.stopPropagation();
    if (pending) return;
    setPending(true);
    try {
      await onStop();
    } catch {
      setPending(false);
    }
    window.setTimeout(() => setPending(false), 5000);
  }

  return (
    <div
      role="row"
      onClick={onOpen}
      className="group grid items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.025]"
      style={{
        gridTemplateColumns: PROFILE_TABLE_GRID_TEMPLATE,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      {/* Name + avatar with state ring */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="flex-shrink-0 rounded-[9px] p-[1.5px] transition-colors"
          style={{ background: STATE_RING_COLOR[profile.state] }}
        >
          <Avatar emoji={emoji} tint={avatarTint} accent={profile.state === "ai"} size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[13px] font-semibold text-neutral-100 truncate group-hover:text-white">
              {profile.name}
            </div>
            <ChevronRight
              size={12}
              className="text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            />
          </div>
          <div className="flex items-center gap-1.5 mono text-[10px] text-neutral-400 truncate">
            <PlatformIcon
              platform={platformFromDeviceFamily(profile.device)}
              size={11}
              className="text-neutral-400 flex-shrink-0"
            />
            <span className="text-neutral-400 flex-shrink-0">
              {platformLabel(platformFromDeviceFamily(profile.device))}
            </span>
            <span className="text-neutral-400 flex-shrink-0">·</span>
            <span className="truncate">{profile.id.slice(0, 12)}</span>
          </div>
        </div>
      </div>

      {/* Status pill + AI tool inline */}
      <div className="flex items-center min-w-0">
        <PillForState profile={profile} runCount={liveRuns.length} />
      </div>

      {/* Tags */}
      <div className="flex gap-1 overflow-hidden">
        {profile.tags.slice(0, 3).map((t) => (
          <span
            key={t}
            className="mz-pill mono text-neutral-400 truncate"
            style={{
              background: "rgba(255,255,255,0.06)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.17)",
              maxWidth: 90,
            }}
          >
            {t}
          </span>
        ))}
        {profile.tags.length > 3 && (
          <span className="mz-pill mono text-neutral-400 flex-shrink-0">
            +{profile.tags.length - 3}
          </span>
        )}
      </div>

      {/* Last opened */}
      <div className="mono text-[11px] text-neutral-400 truncate">
        {profile.lastOpenedAt ? relativeTime(profile.lastOpenedAt) : t("never")}
      </div>

      {/* Proxy — live health (parity with the grid card), compact for the row */}
      <RowProxyHealth profile={profile} />

      {/* Actions — fixed-width column so it doesn't squeeze others; visible on hover or when running */}
      <div
        className={cn(
          "flex items-center justify-end gap-1.5 transition-opacity",
          isRunning || terminating ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {showTerminating ? (
          <Button
            variant="secondary"
            size="sm"
            disabled
            title={t("Terminating…")}
            leftIcon={<Loader2 size={9} className="animate-spin" />}
          >
            {t("Ending")}
          </Button>
        ) : !isRunning ? (
          <Button
            variant="accent"
            size="sm"
            disabled={pending}
            onClick={handleLaunch}
            leftIcon={<Play size={10} fill="currentColor" strokeWidth={0} />}
          >
            {pending ? t("…") : t("Launch")}
          </Button>
        ) : (
          <>
            <Button
              variant="accent"
              size="sm"
              disabled={pending}
              onClick={handleNewInstance}
              title={
                liveRuns.length
                  ? t("Launch one more instance ({count} running: {ports})", {
                      count: liveRuns.length,
                      ports: liveRuns.map((r) => ":" + r.mcpPort).join(", "),
                    })
                  : t("Launch one more instance")
              }
              leftIcon={<Plus size={10} strokeWidth={2.5} />}
            >
              {pending ? t("…") : t("New")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={handleStop}
              title={t("Close ALL instances")}
              leftIcon={<Square size={9} fill="currentColor" strokeWidth={0} />}
            >
              {t("Stop all")}
            </Button>
          </>
        )}
        <RowMenu onEdit={onOpen} onExport={onExport} onDuplicate={onDuplicate} onDelete={onDelete} />
      </div>
    </div>
  );
}

function PillForState({ profile, runCount = 0 }: { profile: TileData; runCount?: number }): JSX.Element {
  const { t } = useI18n();
  if (profile.state === "ai") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md mono text-[10px] truncate"
        style={{
          background: "rgba(255,255,255,0.10)",
          color: "#e5e5e5",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.20)",
        }}
        title={profile.lastTool ?? t("ai-driven")}
      >
        <Zap size={10} className="flex-shrink-0" />
        <span className="truncate">{profile.lastTool ?? t("ai-driven")}</span>
      </span>
    );
  }
  if (profile.state === "running")
    return (
      <Pill kind="running" dot>
        {runCount > 1 ? t("running ×{count}", { count: runCount }) : t("running")}
      </Pill>
    );
  if (profile.state === "error")
    // Dense row: surface the message as a hover tooltip (the grid card has room
    // for a full error line; here the status column does not).
    return (
      <span title={profile.errorMessage} className="inline-flex min-w-0">
        <Pill kind="error">{t("error")}</Pill>
      </span>
    );
  return <Pill kind="idle">{t("idle")}</Pill>;
}

/**
 * Compact live proxy-health for the dense row — parity with the grid card's
 * ProxyHealthRow, trimmed to a flag + short label + a status affordance. Auto-
 * probes (module-cached via useProxyHealth) and re-checks on click. Direct
 * profiles show a muted "direct". The click stops propagation so it re-checks
 * instead of opening the row's Edit.
 */
function RowProxyHealth({ profile }: { profile: TileData }): JSX.Element {
  const { t } = useI18n();
  const { health, recheck } = useProxyHealth(profile.id, profile.proxy, profile.proxyCountry);

  if (health.status === "direct") {
    return (
      <div className="flex items-center gap-1.5 mono text-[11px] text-neutral-400 min-w-0">
        <span className="truncate">{t("direct")}</span>
      </div>
    );
  }

  const cc = health.cc;
  const isError = health.status === "error";
  const label =
    health.status === "ok"
      ? (health.country ?? countryNameFromCc(cc) ?? t("connected"))
      : isError
        ? t("unreachable")
        : (countryNameFromCc(cc) ?? t("checking…"));
  const title = isError
    ? t("{error} — click to retry", { error: health.error })
    : health.status === "ok"
      ? t("{label}{cc} — click to re-check", {
          label,
          cc: cc ? ` · ${cc.toUpperCase()}` : "",
        })
      : t("checking proxy…");

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        recheck();
      }}
      title={title}
      className="flex items-center gap-1.5 mono text-[11px] min-w-0 text-left bg-transparent border-0 cursor-pointer"
    >
      <span
        className="inline-flex flex-shrink-0"
        style={isError ? { filter: "grayscale(1)", opacity: 0.7 } : undefined}
      >
        <Flag cc={cc} />
      </span>
      <span className={cn("truncate", isError ? "text-red-300" : "text-neutral-400")}>{label}</span>
      {health.status === "ok" && (
        <span
          className="w-[6px] h-[6px] rounded-full bg-emerald-500 flex-shrink-0"
          style={{ animation: "mz-dotpulse 1.6s ease-in-out infinite" }}
        />
      )}
      {health.status === "checking" && (
        <Loader2 size={11} className="animate-spin text-amber-400 flex-shrink-0" />
      )}
      {isError && <RefreshCw size={10} className="text-red-300 flex-shrink-0" />}
    </button>
  );
}

function RowMenu({
  onEdit,
  onExport,
  onDuplicate,
  onDelete,
}: {
  onEdit: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Left-anchored + clamped so the 176px menu can never fall off-screen
    // (rows render at the window's left edge in list view).
    const MENU_W = 176;
    const MENU_H = 170;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - MENU_W - 8);
    const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - MENU_H - 8));
    setCoords({ top, left });
    const close = (): void => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={t("More actions")}
        style={{ width: 28, height: 28 }}
      >
        <MoreHorizontal size={13} strokeWidth={1.5} />
      </Button>
      {open && coords &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onMouseDown={() => setOpen(false)}
            />
            <div
              className="fixed z-[61] w-44 py-1 rounded-md"
              // Belt-and-suspenders: contain ALL clicks inside the menu panel
              // (padding, the separator band, future children) so a slight
              // misclick off a button can't bubble through the portal to the
              // row's onClick={onOpen} and open Edit. Complements the per-item
              // guard in MenuItem. Issue #16.
              onClick={(e) => e.stopPropagation()}
              style={{
                top: coords.top,
                left: coords.left,
                background: "rgba(23,23,23,0.98)",
                boxShadow:
                  "inset 0 0 0 1px rgba(255,255,255,0.15), 0 20px 40px rgba(0,0,0,0.6)",
                backdropFilter: "blur(20px)",
              }}
            >
              <MenuItem onClick={() => { setOpen(false); onEdit(); }}>
                {t("Edit profile")}
              </MenuItem>
              <MenuItem onClick={() => { setOpen(false); onExport(); }}>
                {t("Export archive…")}
              </MenuItem>
              <MenuItem onClick={() => { setOpen(false); onDuplicate(); }}>
                {t("Duplicate")}
              </MenuItem>
              <div style={{ height: 1, margin: "4px 0", background: "rgba(255,255,255,0.06)" }} />
              <MenuItem onClick={() => { setOpen(false); onDelete(); }} tone="danger">
                {t("Delete profile")}
              </MenuItem>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "danger";
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        // Stop the click bubbling (through the portal, up the React tree) to the
        // row's onClick={onOpen}, which would otherwise open Edit Profile on top
        // of the Export/Delete flow. Grid view's card root has no onClick so it
        // was unaffected; the List row is clickable, so this leaked. Issue #16.
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-full text-left px-3 py-1.5 text-[12px] cursor-pointer transition-colors hover:bg-white/[0.05]",
        tone === "danger" ? "text-red-400" : "text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}
