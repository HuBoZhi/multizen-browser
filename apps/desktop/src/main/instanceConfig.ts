import { app, dialog } from "electron";
import { join, resolve } from "node:path";

/**
 * Multi-instance launch configuration (FR-1 / FR-2 / FR-8 / FR-6-T1 of the
 * requirements doc, docs/requirements-multi-instance-mcp.md).
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

/** FR-9c placement modes for --window=<mode>. */
export const WINDOW_MODES = [
  "cascade",
  "tile-left",
  "tile-right",
  "quad-1",
  "quad-2",
  "quad-3",
  "quad-4",
] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

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
  /** .mzar archive to import into this instance at startup (FR-6 T1). */
  readonly importProfile: string | null;
  /** Passphrase for --import-profile (archives are always encrypted). */
  readonly importPassphrase: string | null;
  /** Window placement mode (FR-9c). Null = default (maximize / restore). */
  readonly windowMode: WindowMode | null;
  /** The PRE-redirect userData path (upstream default), captured before setPath. */
  readonly defaultUserDataDir: string;
  /** Effective userData dir after applyInstanceConfig() ran. */
  readonly userDataDir: string;
}

/** Fields still unknown until applyInstanceConfig() runs. */
type PendingDirs = "defaultUserDataDir" | "userDataDir";

/** Where the effective MCP port came from — "cli"/"env" overrides are fatal on conflict. */
export type McpPortSource = "cli" | "env" | "settings" | "default";

export class InstanceArgError extends Error {}

/**
 * Extract a `--name=value` / `--name value` pair. Returns null when the flag
 * is absent. Only instance flags are recognized; Electron/Chromium switches
 * (e.g. --inspect) pass through untouched.
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

export function parseInstanceArgs(argv: readonly string[]): Omit<InstanceConfig, PendingDirs> {
  const instanceId = readFlag(argv, "instance-id");
  if (instanceId !== null && !INSTANCE_ID_RE.test(instanceId)) {
    throw new InstanceArgError(
      `--instance-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,63} (it becomes a directory name), got "${instanceId}"`,
    );
  }

  const dataDir = readFlag(argv, "data-dir");
  const mcpPortRaw = readFlag(argv, "mcp-port");
  const launchProfile = readFlag(argv, "launch-profile");
  const importProfile = readFlag(argv, "import-profile");
  const importPassphrase = readFlag(argv, "import-passphrase");

  if (importPassphrase !== null && importProfile === null) {
    throw new InstanceArgError(
      `--import-passphrase only makes sense together with --import-profile`,
    );
  }

  const windowModeRaw = readFlag(argv, "window");
  let windowMode: WindowMode | null = null;
  if (windowModeRaw !== null) {
    const match = WINDOW_MODES.find((m) => m === windowModeRaw);
    if (match === undefined) {
      throw new InstanceArgError(
        `--window must be one of ${WINDOW_MODES.join(", ")} — got "${windowModeRaw}"`,
      );
    }
    windowMode = match;
  }

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
      importProfile,
      importPassphrase,
      windowMode,
    };
  }

  return {
    instanceId,
    dataDir,
    mcpPortArg: mcpPortRaw === null ? null : parsePort(mcpPortRaw, "--mcp-port"),
    mcpPortEnv: null,
    launchProfile,
    importProfile,
    importPassphrase,
    windowMode,
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
 *
 * Also returns the PRE-redirect default userData path — the anchor for the
 * shared engine runtime when no --data-dir was given (FR-3).
 */
export function applyInstanceConfig(
  cfg: Omit<InstanceConfig, PendingDirs>,
): InstanceConfig {
  const defaultUserDataDir = app.getPath("userData");
  if (cfg.dataDir === null && cfg.instanceId === null) {
    return { ...cfg, defaultUserDataDir, userDataDir: defaultUserDataDir };
  }
  const dataDir = cfg.dataDir !== null ? resolve(cfg.dataDir) : null;
  const userDataDir =
    dataDir !== null && cfg.instanceId !== null
      ? join(dataDir, cfg.instanceId)
      : dataDir !== null
        ? dataDir
        : join(defaultUserDataDir, "instances", cfg.instanceId!);
  app.setPath("userData", userDataDir);
  return { ...cfg, defaultUserDataDir, userDataDir };
}

/**
 * FR-2 port priority chain: CLI > environment > settings.json > default 7777.
 * The CLI/env result overrides the loaded settings IN MEMORY only — it is
 * never written back, so a scripted port never pollutes the user's settings.
 */
export function resolveMcpPort(
  cfg: Omit<InstanceConfig, PendingDirs>,
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
 * Root directory for the SHARED Chromium engine runtime (FR-3). All instances
 * launched with the same --data-dir (or, absent that, the same machine default)
 * resolve the same root, so the ~560 MB engine is downloaded once. Null means
 * "no instance flags — keep upstream's per-userData engine cache".
 */
export function sharedEngineRoot(cfg: InstanceConfig): string | null {
  if (cfg.dataDir === null && cfg.instanceId === null) return null;
  return cfg.dataDir !== null ? resolve(cfg.dataDir) : cfg.defaultUserDataDir;
}

/**
 * Parse + validate + apply, with loud failure on bad arguments. Called once at
 * module scope of the main entry; throws after app.exit() so module init halts.
 */
export function initInstanceConfig(argv: readonly string[]): InstanceConfig {
  try {
    const cfg = applyInstanceConfig(parseInstanceArgs(argv));
    process.stdout.write(
      `[multizen] instance=${cfg.instanceId ?? "(default)"} userData=${cfg.userDataDir}\n`,
    );
    return cfg;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[multizen] invalid instance arguments: ${msg}\n`);
    // showErrorBox is one of the few dialogs safe before app ready.
    dialog.showErrorBox("MultiZen failed to start", `Invalid launch arguments:\n\n${msg}`);
    app.exit(1);
    throw e;
  }
}
