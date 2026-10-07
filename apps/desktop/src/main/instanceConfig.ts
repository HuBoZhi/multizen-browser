import { app, dialog } from "electron";
import { join, resolve } from "node:path";

/**
 * Multi-instance launch configuration (FR-1 / FR-2 / FR-8 of the requirements
 * doc, docs/requirements-multi-instance-mcp.md).
 *
 * One MultiZen process = one instance. An instance is named by --instance-id
 * and rooted at its own userData directory, which yields isolated
 * settings.json / profiles.db / MCP token / profile data per instance while
 * every instance still drives the SAME shared Chromium engine download.
 *
 * Everything here must run BEFORE any code touches app.getPath("userData") —
 * i.e. module scope of the main entry, before app.whenReady().
 */

/** --instance-id becomes a directory name — keep it fs-safe on all platforms. */
const INSTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface InstanceConfig {
  /** Instance name (FR-1). Null = default single-instance behavior. */
  readonly instanceId: string | null;
  /** Root directory holding per-instance data (FR-1). Resolved against CWD. */
  readonly dataDir: string | null;
  /** --mcp-port value (FR-2). Null = not given on the command line. */
  readonly mcpPortArg: number | null;
  /** MULTIZEN_MCP_PORT value (FR-2). Null = not set / invalid handled as fatal. */
  readonly mcpPortEnv: number | null;
  /** Profile id or name to auto-launch after startup (FR-8). */
  readonly launchProfile: string | null;
  /** Effective userData dir after applyInstanceConfig() ran. */
  readonly userDataDir: string;
}

/** Where the effective MCP port came from — "cli"/"env" overrides are fatal on conflict. */
export type McpPortSource = "cli" | "env" | "settings" | "default";

export class InstanceArgError extends Error {}

/**
 * Extract a `--name=value` / `--name value` pair. Returns null when the flag
 * is absent. Only the four instance flags are recognized; Electron/Chromium
 * switches (e.g. --inspect) pass through untouched.
 */
function readFlag(argv: readonly string[], name: string): string | null {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length);
      if (!value) {
        throw new InstanceArgError(
          `--${name}= is empty — provide a value (e.g. --${name}=multi-01)`,
        );
      }
      return value;
    }
    if (arg === exact) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new InstanceArgError(`--${name} requires a value (e.g. --${name}=multi-01)`);
      }
      return next;
    }
  }
  return null;
}

function parsePort(raw: string, label: string): number {
  if (!/^\d+$/.test(raw) || !(Number(raw) >= 1 && Number(raw) <= 65535)) {
    throw new InstanceArgError(`${label} must be an integer between 1 and 65535, got "${raw}"`);
  }
  return Number(raw);
}

export function parseInstanceArgs(argv: readonly string[]): Omit<InstanceConfig, "userDataDir"> {
  const instanceId = readFlag(argv, "instance-id");
  if (instanceId !== null && !INSTANCE_ID_RE.test(instanceId)) {
    throw new InstanceArgError(
      `--instance-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63} (it becomes a directory name), got "${instanceId}"`,
    );
  }

  const dataDir = readFlag(argv, "data-dir");
  const mcpPortRaw = readFlag(argv, "mcp-port");
  const launchProfile = readFlag(argv, "launch-profile");

  const envRaw = process.env.MULTIZEN_MCP_PORT;
  if (envRaw !== undefined && envRaw !== "" && mcpPortRaw === null) {
    // Env var only applies when the CLI didn't override it; an invalid env
    // value is still an explicit configuration error — fail loudly, don't guess.
    return {
      instanceId,
      dataDir,
      mcpPortArg: null,
      mcpPortEnv: parsePort(envRaw, "MULTIZEN_MCP_PORT"),
      launchProfile,
    };
  }

  return {
    instanceId,
    dataDir,
    mcpPortArg: mcpPortRaw === null ? null : parsePort(mcpPortRaw, "--mcp-port"),
    mcpPortEnv: null,
    launchProfile,
  };
}

/**
 * Point Electron's userData at this instance's directory (FR-1). Must be
 * called before the first app.getPath("userData") anywhere in the process —
 * including Electron's own internal caches, hence module scope.
 *
 *   --data-dir + --instance-id  →  <data-dir>/<instance-id>   (scripted multi-instance)
 *   --data-dir only             →  <data-dir>                 (user takes full control)
 *   --instance-id only          →  <default userData>/instances/<id>
 *   neither                     →  untouched (official default behavior)
 */
export function applyInstanceConfig(cfg: Omit<InstanceConfig, "userDataDir">): string {
  if (cfg.dataDir === null && cfg.instanceId === null) {
    return app.getPath("userData");
  }
  const dataDir = cfg.dataDir !== null ? resolve(cfg.dataDir) : null;
  const dir =
    dataDir !== null && cfg.instanceId !== null
      ? join(dataDir, cfg.instanceId)
      : dataDir !== null
        ? dataDir
        : join(app.getPath("userData"), "instances", cfg.instanceId!);
  app.setPath("userData", dir);
  return dir;
}

/**
 * FR-2 port priority chain: CLI > environment > settings.json > default 7777.
 * The CLI/env result overrides the loaded settings IN MEMORY only — it is
 * never written back, so a scripted port never pollutes the user's settings.
 */
export function resolveMcpPort(
  cfg: Omit<InstanceConfig, "userDataDir">,
  settingsPort: number | undefined,
): { port: number; source: McpPortSource } {
  if (cfg.mcpPortArg !== null) return { port: cfg.mcpPortArg, source: "cli" };
  if (cfg.mcpPortEnv !== null) return { port: cfg.mcpPortEnv, source: "env" };
  if (typeof settingsPort === "number" && settingsPort >= 1 && settingsPort <= 65535) {
    return { port: settingsPort, source: "settings" };
  }
  return { port: 7777, source: "default" };
}

/**
 * Parse + validate + apply, with loud failure on bad arguments. Called once at
 * module scope of the main entry; throws after app.exit() so module init halts.
 */
export function initInstanceConfig(argv: readonly string[]): InstanceConfig {
  let base: Omit<InstanceConfig, "userDataDir">;
  let userDataDir: string;
  try {
    base = parseInstanceArgs(argv);
    userDataDir = applyInstanceConfig(base);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[multizen] invalid instance arguments: ${msg}\n`);
    // showErrorBox is one of the few dialogs safe before app ready.
    dialog.showErrorBox("MultiZen failed to start", `Invalid launch arguments:\n\n${msg}`);
    app.exit(1);
    throw e;
  }
  process.stdout.write(
    `[multizen] instance=${base.instanceId ?? "(default)"} userData=${userDataDir}\n`,
  );
  return { ...base, userDataDir };
}
