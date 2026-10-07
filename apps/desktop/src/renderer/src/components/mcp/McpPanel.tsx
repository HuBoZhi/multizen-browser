import { useMemo, useState, type JSX } from "react";
import { Check, Copy, Plug, Sparkles, Terminal } from "lucide-react";
import type { ActivityEvent, ProfileSummary } from "../../types";
import type { RunInfo } from "@multizen/types";
import { Pill, Flag, ccFromTimezone } from "../atoms";
import { formatTime } from "../../lib/relativeTime";

interface Props {
  events: ActivityEvent[];
  profiles: ProfileSummary[];
  /** Live browser instances, each with its own MCP endpoint + token. */
  runs?: RunInfo[];
  /** MCP HTTP base URL (e.g. http://127.0.0.1:7777) or null when the server is off. */
  mcpUrl: string | null;
  /** Bearer token every MCP client must send; null when the server is off. */
  mcpToken: string | null;
  /** Multi-instance id this app runs as; null = default single instance. */
  instanceId?: string | null;
}

/**
 * MCP panel: the one place to connect an AI agent to MultiZen and watch what it
 * does. Top half = a "Connect an agent" card (endpoint + copy-paste client
 * config); bottom half = the live feed of MCP tool calls.
 */
export function McpPanel({ events, profiles, runs, mcpUrl, mcpToken, instanceId }: Props): JSX.Element {
  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const recent = useMemo(() => events.slice().reverse(), [events]);

  return (
    <div className="flex-1 overflow-auto" style={{ padding: "24px 32px" }}>
      <div className="max-w-[960px] mx-auto">
        <div className="flex items-baseline gap-3 mb-1.5">
          <div className="text-lg font-bold tracking-tight text-slate-100">MCP</div>
          <div className="mono text-[11px] text-slate-400">·  {events.length} calls</div>
          {instanceId && (
            <span
              className="mono text-[10px] px-2 py-0.5 rounded-md text-purple-300"
              style={{ background: "rgba(168,85,247,0.10)", boxShadow: "inset 0 0 0 1px rgba(168,85,247,0.20)" }}
              title="This app runs as a named multi-instance; this endpoint controls only this instance."
            >
              instance: {instanceId}
            </span>
          )}
        </div>
        <div className="text-[13px] text-slate-500 mb-5 leading-relaxed max-w-[68ch]">
          Drive your profiles from an AI agent. Point any MCP client (Claude Desktop, Cursor,
          Cline, …) at MultiZen, then launch a profile and let the agent open tabs, click, type,
          and read pages through it — every tool call streams into the feed below.
        </div>

        <ConnectCard baseUrl={mcpUrl} token={mcpToken} />

        {runs && runs.length > 0 && <RunsCard runs={runs} />}

        {/* Live feed */}
        <div className="flex items-baseline gap-2.5 mt-7 mb-2.5">
          <div className="text-[13px] font-semibold text-slate-200">Live tool calls</div>
          <div className="mono text-[10px] text-slate-400">{events.length} total</div>
        </div>

        {recent.length === 0 ? (
          <div
            className="text-center"
            style={{
              padding: 40,
              borderRadius: 18,
              background: "rgba(255,255,255,0.035)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)",
            }}
          >
            <div className="text-[13px] font-semibold text-slate-100">No agent calls yet</div>
            <div className="text-[12px] text-slate-500 mt-1.5 leading-relaxed max-w-[46ch] mx-auto">
              Connect a client above, launch a profile, and every MCP tool call the agent makes
              shows up here — with sanitized arguments, outcome, and duration.
            </div>
          </div>
        ) : (
          <div className="mz-card overflow-hidden">
            {recent.map((e, i) => (
              <PageRow
                key={e.id}
                event={e}
                profile={e.profileId ? profilesById.get(e.profileId) : undefined}
                isLast={i === recent.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectCard({
  baseUrl,
  token,
}: {
  baseUrl: string | null;
  token: string | null;
}): JSX.Element {
  const off = baseUrl === null;
  const base = (baseUrl ?? "http://127.0.0.1:7777").replace(/\/$/, "");
  const httpUrl = `${base}/mcp`; // Streamable HTTP — the current MCP transport
  const sseUrl = `${base}/sse`; // legacy HTTP+SSE, kept for older clients
  const bearer = token ?? "<token>"; // placeholder only if the server is off

  // Modern clients speak Streamable HTTP directly by URL — no Node bridge.
  // Codex uses TOML; Cursor/Cline/Continue use JSON with a `url`. Stdio-only
  // clients (Claude Desktop) still need the `mcp-remote` bridge (no url field).
  // The server requires Authorization: Bearer <token>, so every config carries
  // the header in the shape that client expects.
  const jsonConfig = useMemo(
    () =>
      JSON.stringify(
        { mcpServers: { multizen: { url: httpUrl, headers: { Authorization: `Bearer ${bearer}` } } } },
        null,
        2,
      ),
    [httpUrl, bearer],
  );
  const codexConfig = useMemo(
    () =>
      `[mcp_servers.multizen]\nurl = "${httpUrl}"\nhttp_headers = { Authorization = "Bearer ${bearer}" }`,
    [httpUrl, bearer],
  );
  const stdioConfig = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            multizen: {
              command: "npx",
              args: ["mcp-remote", httpUrl, "--header", `Authorization: Bearer ${bearer}`],
            },
          },
        },
        null,
        2,
      ),
    [httpUrl, bearer],
  );

  // A self-contained instruction the user can paste into any coding agent
  // (Claude Code, Cursor, …) so it wires up the connection for them.
  const llmPrompt = useMemo(
    () =>
      [
        "I'm using the MultiZen browser, which runs a local MCP server so an AI agent can drive its browser profiles (open tabs, click, type, read pages).",
        "",
        `It exposes a Streamable HTTP MCP endpoint at: ${httpUrl}`,
        `(A legacy HTTP+SSE endpoint is also available at ${sseUrl} for older clients.)`,
        "",
        `The server requires an auth token. Send this HTTP header on every request: Authorization: Bearer ${bearer}`,
        "",
        "Please connect this MCP server to my MCP client:",
        "1. Detect which MCP client I'm using and where its config file lives.",
        '2. Add a server named "multizen" using the shape that matches my client, INCLUDING the Authorization header:',
        `   - Codex CLI (~/.codex/config.toml):  [mcp_servers.multizen] with  url = "${httpUrl}"  and  http_headers = { Authorization = "Bearer ${bearer}" }`,
        `   - JSON URL clients (Cursor, Cline, Continue, VS Code):  {"mcpServers":{"multizen":{"url":"${httpUrl}","headers":{"Authorization":"Bearer ${bearer}"}}}}`,
        `   - Stdio-only clients (Claude Desktop, no url field) bridge via mcp-remote (needs Node.js):  {"mcpServers":{"multizen":{"command":"npx","args":["mcp-remote","${httpUrl}","--header","Authorization: Bearer ${bearer}"]}}}`,
        "3. Merge it into the existing config without overwriting other servers, then tell me to restart/reload the client.",
        "",
        'Once connected, every MultiZen tool is prefixed "multizen." — I\'ll launch a profile in MultiZen and you can drive it.',
      ].join("\n"),
    [httpUrl, sseUrl, bearer],
  );

  return (
    <div
      style={{
        borderRadius: 18,
        background: "rgba(255,255,255,0.04)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12), 0 24px 48px -24px rgba(0,0,0,0.5)",
        padding: 18,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: "rgba(168,85,247,0.12)",
            color: "#c084fc",
            boxShadow: "inset 0 0 0 1px rgba(168,85,247,0.22)",
          }}
        >
          <Plug size={15} strokeWidth={1.75} />
        </div>
        <div className="text-[13px] font-semibold text-slate-100">Connect an agent</div>
        <div className="ml-auto flex items-center gap-2">
          {!off && <CopyPromptButton prompt={llmPrompt} />}
          {off ? (
            <Pill kind="idle">server off</Pill>
          ) : (
            <Pill kind="running" dot>listening</Pill>
          )}
        </div>
      </div>

      {off ? (
        <div className="text-[12px] text-slate-400 leading-relaxed">
          The MCP server is disabled. Turn on{" "}
          <span className="text-slate-200 font-medium">Auto-start MCP HTTP transport</span> in{" "}
          <span className="text-slate-200 font-medium">Settings</span> to get a connection
          endpoint.
        </div>
      ) : (
        <>
          {/* Endpoint — Streamable HTTP is the current transport */}
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
            Endpoint (Streamable HTTP)
          </div>
          <CopyRow value={httpUrl} mono />
          <div className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
            Legacy HTTP+SSE endpoint (older clients):{" "}
            <code className="mono text-slate-400">{sseUrl}</code>
          </div>

          {/* Auth token — every request needs it; each config below embeds it. */}
          <div className="mt-3 text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
            Auth token
          </div>
          <CopyRow value={bearer} mono />
          <div className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
            Sent as <code className="mono text-slate-400">Authorization: Bearer …</code> — the
            configs below already include it. Keep it secret; anyone with it can drive your
            profiles.
          </div>

          {/* Steps */}
          <ol className="mt-4 space-y-2">
            <Step n={1}>Copy the config for your client below into its MCP config.</Step>
            <Step n={2}>Reload / restart the client so it connects.</Step>
            <Step n={3}>Launch a profile here, and let the agent drive it.</Step>
          </ol>

          {/* Config snippets — three shapes by client type */}
          <div className="mt-4 space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
                Codex CLI — ~/.codex/config.toml
              </div>
              <CopyRow value={codexConfig} mono block />
              <div className="flex items-start gap-1.5 mt-2 text-[11px] text-slate-500 leading-relaxed">
                <Terminal size={12} className="mt-[2px] flex-shrink-0 text-slate-400" />
                <span>
                  The <code className="text-slate-400">url</code> field needs a Codex build with
                  streamable-HTTP MCP support. On older Codex (stdio only), use the{" "}
                  <span className="text-slate-400">Stdio clients</span> config below instead.
                </span>
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
                JSON URL clients — Cursor, Cline, Continue
              </div>
              <CopyRow value={jsonConfig} mono block />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
                Stdio clients — Claude Desktop
              </div>
              <CopyRow value={stdioConfig} mono block />
              <div className="flex items-start gap-1.5 mt-2 text-[11px] text-slate-500 leading-relaxed">
                <Terminal size={12} className="mt-[2px] flex-shrink-0 text-slate-400" />
                <span>
                  Claude Desktop&apos;s config has no <code className="text-slate-400">url</code>{" "}
                  field, so it bridges the endpoint through{" "}
                  <code className="text-slate-400">mcp-remote</code> (needs Node). Change the port
                  in <span className="text-slate-400">Settings</span>.
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2.5 text-[12px] text-slate-300 leading-relaxed">
      <span
        className="flex-shrink-0 flex items-center justify-center mono text-[10px] font-semibold"
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          marginTop: 1,
          background: "rgba(255,255,255,0.05)",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: "#94a3b8",
        }}
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function CopyRow({
  value,
  mono,
  block,
}: {
  value: string;
  mono?: boolean;
  block?: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* clipboard denied (non-secure context) — no-op */
      });
  }
  return (
    <div
      className="flex items-start gap-2"
      style={{
        borderRadius: 10,
        background: "rgba(0,0,0,0.25)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        padding: block ? "10px 10px 10px 12px" : "9px 9px 9px 12px",
      }}
    >
      <pre
        className={mono ? "mono" : ""}
        style={{
          flex: 1,
          minWidth: 0,
          margin: 0,
          fontSize: block ? 11 : 12,
          lineHeight: 1.5,
          color: "#cbd5e1",
          whiteSpace: block ? "pre" : "nowrap",
          overflowX: "auto",
        }}
      >
        {value}
      </pre>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="flex-shrink-0 flex items-center justify-center transition-colors"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: copied ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.04)",
          boxShadow: copied
            ? "inset 0 0 0 1px rgba(16,185,129,0.3)"
            : "inset 0 0 0 1px rgba(255,255,255,0.08)",
          color: copied ? "#6ee7b7" : "#94a3b8",
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/**
 * "Copy for LLM" — copies a ready-to-paste English instruction so the user can
 * hand connection setup to a coding agent (Claude Code, Cursor, …) instead of
 * editing config files by hand.
 */
function CopyPromptButton({ prompt }: { prompt: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  function copy(): void {
    navigator.clipboard
      .writeText(prompt)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        /* clipboard denied (non-secure context) — no-op */
      });
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a prompt you can paste into Claude Code / Cursor to set up the connection"
      className="flex items-center gap-1.5 transition-colors"
      style={{
        height: 26,
        padding: "0 10px",
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        background: copied ? "rgba(16,185,129,0.14)" : "rgba(168,85,247,0.12)",
        boxShadow: copied
          ? "inset 0 0 0 1px rgba(16,185,129,0.3)"
          : "inset 0 0 0 1px rgba(168,85,247,0.24)",
        color: copied ? "#6ee7b7" : "#c084fc",
      }}
    >
      {copied ? <Check size={12} /> : <Sparkles size={12} />}
      {copied ? "Copied" : "Copy for LLM"}
    </button>
  );
}

function PageRow({
  event,
  profile,
  isLast,
}: {
  event: ActivityEvent;
  profile?: ProfileSummary;
  isLast: boolean;
}): JSX.Element {
  const cc = profile
    ? ccFromTimezone(profile.tags.find((t) => t.startsWith("tz:"))?.slice(3))
    : undefined;
  return (
    <div
      className="flex items-start gap-3"
      style={{
        padding: "12px 18px",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
        background: event.status === "pending" ? "rgba(168,85,247,0.04)" : undefined,
      }}
    >
      <StatusPill status={event.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <code className="mono text-[12px] font-semibold text-slate-100">
            <span className="text-purple-400">multizen.</span>
            {event.tool}
          </code>
          <span className="ml-auto mono text-[10px] text-slate-500">
            {formatTime(event.timestamp)}
            {event.durationMs !== undefined && ` · ${event.durationMs}ms`}
          </span>
        </div>
        {event.summary && (
          <div className="text-[12px] text-slate-400 mt-0.5 truncate">{event.summary}</div>
        )}
        {profile && (
          <div className="mono text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
            <Flag cc={cc} />
            {profile.name} · {profile.id.slice(0, 12)}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ActivityEvent["status"] }): JSX.Element {
  if (status === "ok") return <Pill kind="running">ok</Pill>;
  if (status === "pending") return <Pill kind="ai" dot>live</Pill>;
  return <Pill kind="error">error</Pill>;
}

/**
 * Live browser instances (run model): every running profile instance gets its
 * OWN MCP endpoint + bearer token, so an agent can bind to exactly one
 * browser while another agent drives a sibling instance of the same profile.
 */
function RunsCard({ runs }: { runs: RunInfo[] }): JSX.Element {
  return (
    <div
      className="mt-4"
      style={{
        borderRadius: 18,
        background: "rgba(255,255,255,0.035)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
        padding: 18,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="flex items-center justify-center"
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: "rgba(52,211,153,0.12)",
            color: "#34d399",
            boxShadow: "inset 0 0 0 1px rgba(52,211,153,0.22)",
          }}
        >
          <Plug size={15} />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-slate-100">
            Running browser instances
          </div>
          <div className="text-[11px] text-slate-500">
            Each instance has its own MCP endpoint — point an agent at one to drive exactly that
            browser.
          </div>
        </div>
        <span className="mono text-[10px] text-slate-500 ml-auto">{runs.length} live</span>
      </div>
      <div className="space-y-3">
        {runs.map((r) => (
          <div
            key={r.runId}
            style={{
              borderRadius: 12,
              background: "rgba(0,0,0,0.2)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)",
              padding: 12,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[12px] font-semibold text-slate-200 truncate">
                {r.profileName ?? r.profileId}
              </span>
              {r.ephemeral && (
                <span
                  className="mono text-[9px] px-1.5 py-0.5 rounded text-amber-300"
                  style={{ background: "rgba(245,158,11,0.10)" }}
                  title="This instance runs on a disposable working copy — changes are discarded when it closes."
                >
                  ephemeral
                </span>
              )}
              <span className="mono text-[10px] text-slate-400 ml-auto truncate">
                run {r.runId.slice(-6)} · since {formatTime(r.startedAt)}
              </span>
            </div>
            <div className="space-y-1.5">
              <CopyRow value={r.mcpEndpoint} mono />
              <CopyRow value={r.mcpToken} mono />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
