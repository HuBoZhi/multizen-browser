import { useEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { Camera, Loader2, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Square, X, Zap } from "lucide-react";
import type { RunInfo } from "@multizen/types";
import type { ProfileSummary } from "../../types";
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
import { cn } from "../../lib/cn";
import { profileEmoji } from "../../lib/profileEmoji";
import { useI18n } from "../../lib/i18n";
import { emojiTint } from "../../lib/emojiTint";
import { useProxyHealth } from "../../lib/proxyHealth";
import type { ActivityEvent } from "../../types";

export type TileState = "idle" | "running" | "ai" | "error";

export interface TileData extends ProfileSummary {
  state: TileState;
  lastTool?: string;
  lastDuration?: string;
  errorMessage?: string;
}

const RING_BY_STATE: Record<TileState, string> = {
  idle: "rgba(255,255,255,0.05)",
  running: "rgba(16,185,129,0.30)",
  ai: "rgba(255,255,255,0.30)",
  error: "rgba(239,68,68,0.30)",
};

// Use a transparent shadow for idle instead of "none". CSS does not
// accept the literal `none` inside a comma-separated box-shadow list —
// the entire declaration is discarded as invalid, and with the
// `transition-all` on this element the previous (running) shadow keeps
// rendering until something else forces a repaint. A 0-spread
// transparent shadow keeps the syntax valid AND animates cleanly.
const GLOW_BY_STATE: Record<TileState, string> = {
  idle: "0 0 0 0 rgba(0,0,0,0)",
  running: "0 0 32px rgba(16,185,129,0.18)",
  ai: "0 0 32px rgba(255,255,255,0.18)",
  error: "0 0 32px rgba(239,68,68,0.15)",
};

interface Props {
  profile: TileData;
  /** This profile's live browser instances (run model). */
  runs?: RunInfo[];
  /** Chromium is winding down (window closed / Stop pressed) but not yet
   *  exited — show a "Terminating…" transitional state instead of "Stop". */
  terminating?: boolean;
  onOpen: () => void;
  onLaunch: () => Promise<void> | void;
  /** Launch ONE MORE instance (run 2+ executes on a disposable copy). */
  onNewInstance: () => Promise<void> | void;
  /** Close exactly one running instance by run id. */
  onCloseRun: (runId: string) => void;
  /** Capture ONE instance's page content (in-browser CDP screenshot). */
  onScreenshotRun: (run: RunInfo) => void;
  onStop: () => Promise<void> | void;
  onExport: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function ProfileTile({
  profile,
  runs,
  terminating = false,
  onOpen,
  onLaunch,
  onNewInstance,
  onCloseRun,
  onScreenshotRun,
  onStop,
  onExport,
  onDuplicate,
  onDelete,
}: Props): JSX.Element {
  const { t } = useI18n();
  const isRunning = profile.state !== "idle";
  const liveRuns = runs ?? [];
  // Run-model wind-down: the profile-level "terminating" flag only blocks the
  // buttons when NO live runs remain (everything is going away). With runs
  // still alive, sibling instances stay fully controllable.
  const showTerminating = terminating && liveRuns.length === 0;
  // Emoji avatar: user's custom `icon` if set, else a classifier-derived
  // default from name/tags/id, on a deterministic muted tile tint.
  const emoji = profileEmoji(profile.icon, profile.name, profile.tags, profile.id);
  const avatarTint = emojiTint(emoji);

  // Disable Launch/Stop during the actual transition so the user can't
  // double-click and spawn a second Chromium process.
  const [pending, setPending] = useState(false);

  // When the running-state actually flips, clear the pending lock.
  // (External close, MCP-triggered launch, etc. should also unlock.)
  useEffect(() => {
    setPending(false);
  }, [profile.isRunning]);

  async function handleLaunch(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onLaunch();
    } catch {
      setPending(false);
    }
    // pending lifts when isRunning flips via the effect above.
    // Safety net: if the launch never produced a state change (e.g. error toast),
    // unlock after 5s so the button doesn't stay disabled forever.
    window.setTimeout(() => setPending(false), 5000);
  }

  async function handleNewInstance(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await onNewInstance();
    } catch {
      setPending(false);
    }
    window.setTimeout(() => setPending(false), 5000);
  }

  function handleCloseRun(e: React.MouseEvent, runId: string): void {
    e.stopPropagation();
    onCloseRun(runId);
  }

  function handleScreenshotRun(e: React.MouseEvent, run: RunInfo): void {
    e.stopPropagation();
    onScreenshotRun(run);
  }

  async function handleStop(): Promise<void> {
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
      className="flex flex-col gap-2.5 p-3.5 relative transition-all h-full"
      style={{
        borderRadius: 18,
        background: "rgba(255,255,255,0.06)",
        boxShadow: `inset 0 0 0 1px ${RING_BY_STATE[profile.state]}, 0 24px 48px -16px rgba(0,0,0,0.5), ${GLOW_BY_STATE[profile.state]}`,
        backdropFilter: "blur(20px)",
        transitionTimingFunction: "cubic-bezier(0.2,0.8,0.2,1)",
        transitionDuration: "180ms",
      }}
    >
      {/* Header — clickable, opens the edit modal (where the emoji picker lives) */}
      <button
        type="button"
        onClick={onOpen}
        className="group flex justify-between items-start gap-2.5 cursor-pointer text-left bg-transparent border-0 p-0"
      >
        <div className="flex gap-2.5 items-center min-w-0">
          <div className="relative flex-shrink-0" title={t("Click to set an emoji")}>
            <Avatar emoji={emoji} tint={avatarTint} accent={profile.state === "ai"} size={40} />
            <span
              className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                background: "#1a1a1a",
                color: "#a3a3a3",
                boxShadow: "0 0 0 2px #141414, inset 0 0 0 1px rgba(255,255,255,0.15)",
              }}
            >
              <Pencil size={8} strokeWidth={2} />
            </span>
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[13px] leading-tight text-neutral-100 truncate hover:text-white transition-colors">
              {profile.name}
            </div>
            <div className="mono text-[10px] text-neutral-400 mt-[3px] truncate">
              {profile.id.slice(0, 12)}
            </div>
          </div>
        </div>
        <PillForState state={profile.state} />
      </button>

      {/* Tags */}
      {profile.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {profile.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="mz-pill mono text-neutral-400"
              style={{
                background: "rgba(255,255,255,0.06)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.17)",
              }}
            >
              {t}
            </span>
          ))}
          {profile.tags.length > 4 && (
            <span className="mz-pill mono text-neutral-400">+{profile.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Foregrounded proxy row — flag + country + live health (auto-check) */}
      <ProxyHealthRow profile={profile} />

      {/* Context line per state */}
      <ContextLine profile={profile} />

      {/* Bottom meta — platform + last opened */}
      <div className="flex items-center gap-1.5 mono text-[10px] text-neutral-400 leading-tight">
        <PlatformIcon
          platform={platformFromDeviceFamily(profile.device)}
          size={12}
          className="text-neutral-400"
        />
        <span className="text-neutral-400">
          {platformLabel(platformFromDeviceFamily(profile.device))}
        </span>
        <span className="text-neutral-400">·</span>
        <span className="truncate">
          {profile.lastOpenedAt ? relativeTime(profile.lastOpenedAt) : t("never opened")}
        </span>
      </div>

      {/* Actions — pinned to the card bottom so buttons align across a row
          regardless of how much content (tags / context line) sits above.
          Run model: idle → single Launch; running → [+ New instance] [Stop all]
          plus one row per live instance with its own close (✕) control. */}
      <div className="mt-auto pt-1 space-y-1.5">
        {liveRuns.length > 0 && (
          <div className="space-y-1">
            {liveRuns.map((r) => (
              <div
                key={r.runId}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[10px]"
                style={{ background: "rgba(16,185,153,0.05)", boxShadow: "inset 0 0 0 1px rgba(16,185,153,0.16)" }}
              >
                <span
                  className="w-[6px] h-[6px] rounded-full bg-emerald-400 flex-shrink-0"
                  style={{ animation: "mz-dotpulse 1.6s ease-in-out infinite" }}
                />
                <span className="mono text-[11px] text-emerald-300 truncate">
                  :{r.mcpPort}
                </span>
                {r.ephemeral && (
                  <span
                    className="mono text-[9px] px-1 py-px rounded text-amber-300 flex-shrink-0"
                    style={{ background: "rgba(245,158,11,0.10)" }}
                    title={t("This instance runs on a disposable working copy — its changes are discarded when it closes.")}
                  >
                    {t("ephemeral")}
                  </span>
                )}
                <span className="mono text-[9px] text-neutral-400 ml-auto flex-shrink-0">
                  {relativeTime(r.startedAt)}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleScreenshotRun(e, r)}
                  title={t("Screenshot this instance's page (in-browser capture, never the desktop)")}
                  aria-label={t("Screenshot this instance")}
                  className="no-drag w-5 h-5 rounded-md flex items-center justify-center text-neutral-400 hover:text-neutral-200 hover:bg-white/10 transition-colors cursor-pointer border-0 bg-transparent flex-shrink-0"
                >
                  <Camera size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleCloseRun(e, r.runId)}
                  title={t("Close this instance (other instances stay up)")}
                  aria-label={t("Close this instance")}
                  className="no-drag w-5 h-5 rounded-md flex items-center justify-center text-neutral-400 hover:text-red-300 hover:bg-red-400/10 transition-colors cursor-pointer border-0 bg-transparent flex-shrink-0"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          {showTerminating ? (
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              disabled
              leftIcon={<Loader2 size={11} className="animate-spin" />}
            >
              {t("Terminating…")}
            </Button>
          ) : !isRunning ? (
            <Button
              variant="accent"
              size="md"
              disabled={pending}
              onClick={handleLaunch}
              leftIcon={<Play size={11} fill="currentColor" strokeWidth={0} />}
            >
              {pending ? t("Launching…") : t("Launch")}
            </Button>
          ) : (
            <>
              <Button
                variant="accent"
                size="md"
                // flex-1, not w-full: a 100%-width flex item's basis demands the
                // whole row, squeezing the sibling Stop-all button below its
                // label width (text wrapped to two lines). flex-1 fills the
                // leftover space after Stop-all takes its natural width.
                className="flex-1"
                disabled={pending}
                onClick={handleNewInstance}
                leftIcon={<Plus size={11} strokeWidth={2.5} />}
              >
                {pending ? t("Starting…") : t("New instance")}
              </Button>
              <Button
                variant="secondary"
                size="md"
                disabled={pending}
                onClick={handleStop}
                title={t("Close ALL instances of this profile")}
                leftIcon={<Square size={10} fill="currentColor" strokeWidth={0} />}
              >
                {t("Stop all")}
              </Button>
            </>
          )}
          <ActionMenu onEdit={onOpen} onExport={onExport} onDuplicate={onDuplicate} onDelete={onDelete} />
        </div>
      </div>
    </div>
  );
}

/**
 * Foregrounded proxy row: country flag + name + live health. Auto-probes on
 * mount (module-cached + concurrency-limited via useProxyHealth); click to
 * re-check. Direct profiles show a muted "no proxy" line instead.
 */
function ProxyHealthRow({ profile }: { profile: TileData }): JSX.Element {
  const { t } = useI18n();
  const { health, recheck } = useProxyHealth(profile.id, profile.proxy, profile.proxyCountry);

  if (health.status === "direct") {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-2 rounded-[11px]"
        style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.19)" }}
      >
        <span className="text-[12px] font-semibold text-neutral-400 truncate">{t("Direct — no proxy")}</span>
        <span className="ml-auto mono text-[10px] text-neutral-400">{t("host DNS")}</span>
      </div>
    );
  }

  const cc = health.cc;
  const isError = health.status === "error";
  const label =
    health.status === "ok"
      ? (health.country ?? countryNameFromCc(cc) ?? t("Connected"))
      : isError
        ? t("Proxy unreachable")
        : (countryNameFromCc(cc) ?? t("Checking…"));
  const title = isError
    ? t("{error} — click to retry", { error: health.error })
    : health.status === "ok"
      ? t("{label}{cc} — click to re-check", { label, cc: cc ? ` · ${cc.toUpperCase()}` : "" })
      : t("Checking proxy…");

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        recheck();
      }}
      title={title}
      className="flex items-center gap-2 px-2.5 py-2 rounded-[11px] w-full text-left border-0 cursor-pointer transition-colors"
      style={
        isError
          ? { background: "rgba(239,68,68,0.06)", boxShadow: "inset 0 0 0 1px rgba(239,68,68,0.22)" }
          : { background: "rgba(255,255,255,0.028)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)" }
      }
    >
      <span
        className="inline-flex"
        style={isError ? { filter: "grayscale(1)", opacity: 0.7 } : undefined}
      >
        <Flag cc={cc} large />
      </span>
      <span
        className={cn(
          "text-[12.5px] font-semibold truncate",
          isError ? "text-red-300" : "text-neutral-200",
        )}
      >
        {label}
      </span>

      {health.status === "ok" && (
        <span className="ml-auto inline-flex items-center gap-1.5">
          {profile.proxy && (
            <span className="mono text-[10px] text-neutral-400">{t("proxy")}</span>
          )}
          <span
            className="w-[7px] h-[7px] rounded-full bg-emerald-500"
            style={{ animation: "mz-dotpulse 1.6s ease-in-out infinite" }}
          />
        </span>
      )}
      {health.status === "checking" && (
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold"
          style={{ color: "#f5b34a" }}
        >
          <Loader2 size={12} className="animate-spin" />
          {t("Checking…")}
        </span>
      )}
      {isError && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-300">
          <RefreshCw size={11} />
          {t("retry")}
        </span>
      )}
    </button>
  );
}

function PillForState({ state }: { state: TileState }): JSX.Element {
  const { t } = useI18n();
  if (state === "ai") return <Pill kind="ai" dot glow>{t("ai-driven")}</Pill>;
  if (state === "running") return <Pill kind="running" dot glow>{t("running")}</Pill>;
  if (state === "error") return <Pill kind="error">{t("error")}</Pill>;
  return <Pill kind="idle">{t("idle")}</Pill>;
}

function ContextLine({ profile }: { profile: TileData }): JSX.Element | null {
  if (profile.state === "ai") {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
        style={{
          background: "rgba(255,255,255,0.06)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      >
        <Zap size={12} className="text-neutral-300" />
        <span className="mono text-[11px] text-neutral-100 truncate flex-1">
          <span className="text-neutral-300">multizen.</span>
          {profile.lastTool ?? "…"}
        </span>
        {profile.lastDuration && (
          <span className="mono text-[10px] text-neutral-200">{profile.lastDuration}</span>
        )}
      </div>
    );
  }
  if (profile.state === "error" && profile.errorMessage) {
    return (
      <div className="mono text-[11px] leading-tight text-red-400 truncate">
        {profile.errorMessage}
      </div>
    );
  }
  return null;
}

/**
 * Action popover that escapes the tile's clipping. Rendered into a portal
 * with `position: fixed` coordinates so the brand glow / overflow on the
 * tile cannot crop it.
 */
function ActionMenu({
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
    // The menu is 176px wide; a trigger near the screen's left edge made
    // right-anchored positioning push it off-screen. Anchor by LEFT edge and
    // clamp both axes into the viewport.
    const MENU_W = 176;
    const MENU_H = 170; // 4 items + padding + separator, approx.
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - MENU_W - 8);
    const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - MENU_H - 8));
    setCoords({ top, left });
    function onScroll(): void {
      setOpen(false);
    }
    function onResize(): void {
      setOpen(false);
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("More actions")}
      >
        <MoreHorizontal size={14} strokeWidth={1.5} />
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
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-1.5 text-[12px] cursor-pointer transition-colors hover:bg-white/[0.05]",
        tone === "danger" ? "text-red-400" : "text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}

export function deriveTileState(
  profile: ProfileSummary,
  recentEvents: ActivityEvent[],
): Pick<TileData, "state" | "lastTool" | "lastDuration" | "errorMessage"> {
  if (!profile.isRunning) return { state: "idle" };

  const recent = recentEvents
    .filter((e) => e.profileId === profile.id)
    .slice()
    .reverse();

  const lastError = recent.find((e) => e.status === "error");
  const lastDriveCall = recent.find(
    (e) =>
      e.tool !== "list_profiles" &&
      e.tool !== "launch_profile" &&
      e.tool !== "close_profile",
  );

  if (lastError && Date.now() - new Date(lastError.timestamp).getTime() < 30_000) {
    return { state: "error", errorMessage: lastError.summary };
  }

  if (lastDriveCall && Date.now() - new Date(lastDriveCall.timestamp).getTime() < 8_000) {
    return {
      state: "ai",
      lastTool: lastDriveCall.tool,
      lastDuration: lastDriveCall.durationMs ? `${lastDriveCall.durationMs}ms` : undefined,
    };
  }

  return { state: "running" };
}
