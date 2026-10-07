import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  ProfileManager,
  exportProfile,
  importProfile,
  generateFingerprint,
  reconcileFingerprint,
  FingerprintReconcileError,
  deviceCatalog,
  localeCatalog,
  findLocaleIdByCountry,
} from "@multizen/profile-manager";
import {
  HttpTransport,
  createMultizenMcpServer,
  type ActivityEvent,
  type ActivityLog,
} from "@multizen/mcp-server";
import { SettingsStore, defaultSettingsPath, type AppSettings } from "@multizen/settings-store";
import type {
  ChromiumStatus,
  EngineUpdateStatus,
  ExtensionConfig,
  ProxyConfig,
  UpdateStatus,
} from "@multizen/types";
import { ChromiumBrowserDriver } from "./ChromiumBrowserDriver.ts";
import { ChromiumBootstrap } from "./ChromiumBootstrap.ts";
import { UpdaterService } from "./UpdaterService.ts";
import { EngineUpdateService } from "./EngineUpdateService.ts";
import { UsageReporting } from "./UsageReporting.ts";
import { loadOrCreateMcpToken } from "./mcpToken.ts";
import { ExtensionsService } from "./extensions/ExtensionsService.ts";
import {
  sweepOrphans,
  storeEntryDir,
  resolveLoadDir,
  readManifestIcon,
} from "./extensions/extensionStore.ts";
import { probeProxyGeo, type ProxyGeoResult } from "./proxyGeo.ts";
import { initInstanceConfig, resolveMcpPort, sharedEngineRoot } from "./instanceConfig.ts";
import { withEngineInstallLock } from "./engineInstallLock.ts";
import { clampWindowState, placementBounds, type WindowState } from "./windowState.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Resolve the master 1024×1024 brand icon. In packaged builds Electron picks
 * the bundled icon based on platform (.icns on Mac, the .ico/.png on Win/Linux).
 * In dev we fall back to the source PNG so the dock / taskbar / window icons
 * are not the default Electron logo.
 */
function resolveAppIcon(): string | null {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, "icon.png"),
        join(process.resourcesPath, "..", "icon.png"),
      ]
    : [
        join(__dirname, "../../../../build/icon.png"),
        join(__dirname, "../../../build/icon.png"),
        join(__dirname, "../../build/icon.png"),
      ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let mainWindow: BrowserWindow | null = null;

/**
 * Send an IPC message to the renderer, but only if the window and its
 * webContents are still alive. During app teardown a still-running profile's
 * child-process exit fires `running-changed` AFTER the window is destroyed; a
 * plain `mainWindow?.` guards only null, not a destroyed webContents, so calling
 * `.send` on it throws "Object has been destroyed" as an uncaught exception on
 * quit. This guard makes every renderer send teardown-safe.
 */
function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

let profileManager: ProfileManager;
let browserDriver: ChromiumBrowserDriver;
let chromiumBootstrap: ChromiumBootstrap;
let updater: UpdaterService;
let engineUpdater: EngineUpdateService;
let usageReporting: UsageReporting;
let extensionsService: ExtensionsService;
/** Recent companion installs, to de-dupe the marker's retry logs. */
const recentCompanionInstalls = new Set<string>();
let activityLog: ActivityLog;
let settingsStore: SettingsStore;
let httpTransport: HttpTransport | null = null;
let mcpAuthToken: string | null = null;
let cachedSettings: AppSettings | null = null;

function createWindow(): void {
  const iconPath = resolveAppIcon();
  // FR-9c: an explicit --window=<mode> placement wins over everything — it is
  // computed from the primary workArea (on-screen by construction) and is
  // deliberately NOT persisted, so the next flag-less launch returns to the
  // normal maximize/restore behavior.
  const placement =
    instance.windowMode !== null ? placementBounds(instance.windowMode, instance.instanceId) : null;
  // FR-9b: restore the last geometry, clamped into a visible work area (a
  // position persisted on a since-unplugged monitor must not strand the
  // window off-screen). First run (nothing persisted) → default size,
  // maximized (FR-9a).
  const savedBounds = cachedSettings?.windowBounds;
  const restore: WindowState | null =
    placement === null && savedBounds
      ? clampWindowState({
          x: savedBounds.x,
          y: savedBounds.y,
          width: savedBounds.width,
          height: savedBounds.height,
          maximized: cachedSettings?.windowMaximized ?? true,
        })
      : null;
  mainWindow = new BrowserWindow({
    ...(placement
      ? { x: placement.x, y: placement.y, width: placement.width, height: placement.height }
      : restore
        ? { x: restore.x, y: restore.y, width: restore.width, height: restore.height }
        : { width: 1280, height: 800 }),
    minWidth: 900,
    minHeight: 600,
    // Hidden until first paint + maximize, so the window never flashes at
    // 1280×800 before growing (FR-9a of the requirements doc).
    show: false,
    // FR-7: distinguish parallel instances at a glance in the title bar and
    // taskbar. page-title-updated below keeps the renderer from overwriting
    // it with the page's <title>.
    title: instance.instanceId !== null ? `MultiZen — ${instance.instanceId}` : "MultiZen",
    // macOS: hiddenInset shows the traffic lights inset into the app header.
    // Windows: hidden + titleBarOverlay replaces the stock white title bar
    // (and its menu bar) with native min/max/close controls drawn over the
    // dark header — hiddenInset is macOS-only and silently falls back to the
    // default frame on Windows. Linux keeps the default frame (overlay
    // support there is WM-dependent).
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : process.platform === "win32"
        ? {
            titleBarStyle: "hidden" as const,
            titleBarOverlay: {
              color: "#101218",
              symbolColor: "#94a3b8",
              height: 44,
            },
          }
        : {}),
    backgroundColor: "#101218",
    icon: iconPath ?? undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
    },
  });
  mainWindow.on("page-title-updated", (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Open maximized by default. maximize() while still hidden, then reveal —
  // the user's first frame is already the maximized window. An explicit
  // placement (FR-9c) or a restored NON-maximized geometry shows as-is.
  // Safety net: ready-to-show can be starved indefinitely when the renderer's
  // first paint is delayed (e.g. another MultiZen instance holds the shared
  // userData cache) — a hung reveal is worse than a non-maximized first
  // frame, so a timer reveals anyway.
  let revealed = false;
  const reveal = (): void => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    if (placement === null && (restore === null || restore.maximized)) mainWindow.maximize();
    mainWindow.show();
  };
  mainWindow.once("ready-to-show", reveal);
  setTimeout(reveal, 5000);

  // FR-9b: persist geometry on close — normal (non-maximized) bounds + the
  // maximized flag — through settingsStore.update(), whose internal cache is
  // file-truth, so a CLI --mcp-port override living only in the local
  // cachedSettings copy can never leak into settings.json here. Explicit
  // --window placements are skipped: they're per-launch by design.
  mainWindow.on("close", () => {
    if (placement !== null) return;
    const win = mainWindow;
    if (!win || win.isDestroyed() || !settingsStore) return;
    try {
      const normal = win.getNormalBounds();
      void settingsStore
        .update({ windowBounds: normal, windowMaximized: win.isMaximized() })
        .catch(() => {});
    } catch {
      // best-effort — a teardown race is never worth failing on
    }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, description, url) => {
    process.stderr.write(`Renderer failed to load (${code} ${description}): ${url}\n`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    process.stderr.write(`Renderer process gone: ${JSON.stringify(details)}\n`);
  });
}

// Name must be set BEFORE app.whenReady() so the dock and menu bar pick
// it up — otherwise macOS shows "Electron" until app fully loads.
app.setName("MultiZen");
app.setAboutPanelOptions({
  applicationName: "MultiZen",
  applicationVersion: app.getVersion(),
});

// Multi-instance config (FR-1): parse --instance-id / --data-dir / --mcp-port /
// --launch-profile / --import-profile and redirect userData BEFORE anything
// reads it — setName above first (it feeds the default %APPDATA%/MultiZen
// path), then setPath. With no instance flags this is a no-op and behavior is
// exactly upstream.
const instance = initInstanceConfig(process.argv);

// FR-4: per-instance single-instance lock. Electron keys the OS lock on the
// userData path, so AFTER the setPath above this naturally means: same
// instance-id twice → second launch refused; different ids → no interference.
// Deliberately NOT applied to flag-less launches — upstream has no lock, and
// adding one would change official default behavior.
if (instance.instanceId !== null || instance.dataDir !== null) {
  if (!app.requestSingleInstanceLock()) {
    const label = instance.instanceId ?? instance.dataDir!;
    process.stderr.write(`[multizen] another MultiZen instance "${label}" is already running\n`);
    dialog.showErrorBox(
      "MultiZen — instance already running",
      `An instance ${instance.instanceId !== null ? `with --instance-id=${instance.instanceId} ` : ""}on this data directory is already running.\n\n` +
        `Focus the existing window instead of launching a duplicate.`,
    );
    app.exit(1);
    throw new Error(`instance "${label}" already running`);
  }
  // The lock holder learns about the duplicate attempt — bring the existing
  // window forward so the user isn't left wondering why nothing happened.
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // macOS: explicitly set the dock icon. In packaged .app bundles macOS
  // picks the .icns automatically, but in dev (running ./node_modules/.bin/electron)
  // the dock shows the generic Electron icon unless we override it here.
  if (process.platform === "darwin" && !app.isPackaged) {
    const iconPath = resolveAppIcon();
    if (iconPath) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock?.setIcon(img);
    }
  }

  const userData = app.getPath("userData");
  const dataRoot = join(userData, "data");
  // Shared extension store (deduped extension files loaded into many profiles).
  const extensionStoreRoot = join(dataRoot, "extension-store");

  settingsStore = new SettingsStore(defaultSettingsPath(userData));
  cachedSettings = await settingsStore.load();

  // FR-2: effective MCP port = --mcp-port > MULTIZEN_MCP_PORT > settings.json
  // > default 7777. A CLI/env override lives in memory only — it never gets
  // written back to settings.json, so scripted instances stay disposable.
  const mcpPort = resolveMcpPort(instance, cachedSettings.mcpHttpPort);
  if (mcpPort.source === "cli" || mcpPort.source === "env") {
    cachedSettings = { ...cachedSettings, mcpHttpPort: mcpPort.port };
  }
  process.stdout.write(`[multizen] mcp port=${mcpPort.port} (source: ${mcpPort.source})\n`);

  profileManager = new ProfileManager({
    dbPath: join(dataRoot, "profiles.db"),
    profilesRoot: join(dataRoot, "profiles"),
  });

  // Reclaim shared store entries no profile references any more (e.g. left by a
  // crash mid-delete) plus stale staging dirs. Best-effort; never blocks startup.
  void sweepOrphans(
    extensionStoreRoot,
    profileManager.allExtensionRefs().map((r) => r.ext),
  )
    .then((res) => {
      if (res.removed > 0) {
        process.stdout.write(`[multizen] extension-store sweep reclaimed ${res.removed} orphan(s)\n`);
      }
    })
    .catch(() => {});

  // Chromium bootstrap — picks the engine from user settings (CFT default,
  // CloakBrowser opt-in for stronger anti-detect), downloads it on first
  // run, and reports progress to the renderer.
  // FR-3: when instance flags are active, the engine cache moves OUT of the
  // per-instance userData into a SHARED runtime root, so N instances share
  // one ~560 MB download instead of N. Flag-less launches keep upstream's
  // userData/chromium location untouched.
  const engineSharedRoot = sharedEngineRoot(instance);
  const engineCacheDir =
    engineSharedRoot !== null
      ? join(engineSharedRoot, "runtime", "chromium", cachedSettings.browserEngine)
      : null;
  process.stdout.write(
    `[multizen] engine cache=${engineCacheDir ?? `${join(userData, "chromium", cachedSettings.browserEngine)} (per-instance default)`}\n`,
  );
  chromiumBootstrap = new ChromiumBootstrap({
    engine: cachedSettings.browserEngine,
    ...(engineCacheDir !== null ? { cacheDir: engineCacheDir } : {}),
  });
  chromiumBootstrap.on("status", (status: ChromiumStatus) => {
    sendToRenderer("chromium:status", status);
  });
  // Kick off the ensure() in the background so the UI can render immediately
  // and show download progress. Profile launches will wait until ready.
  // FR-3: under a shared cache dir, the (potentially 560 MB) first download
  // is serialized across instances with a cross-process install lock — a
  // second instance cold-starting alongside waits here, then hits the cache.
  const ensureEngine = (): Promise<unknown> =>
    engineCacheDir !== null
      ? withEngineInstallLock(engineCacheDir, () => chromiumBootstrap.ensure())
      : chromiumBootstrap.ensure();
  void ensureEngine().catch((e) => {
    process.stderr.write(`Chromium bootstrap failed: ${String(e)}\n`);
  });

  // Browser-ENGINE update manager. Keeps the downloaded Chromium runtime
  // (CloakBrowser / CFT) fresh — background check + side-by-side stage that
  // applies on the next profile launch, never interrupting a running browser.
  // Reads settings live so the engineAutoUpdate toggle takes effect without
  // restart. Best-effort: a failed check never blocks a launch.
  engineUpdater = new EngineUpdateService({
    bootstrap: chromiumBootstrap,
    getSettings: () => cachedSettings as AppSettings,
  });
  engineUpdater.on("status", (status: EngineUpdateStatus) => {
    sendToRenderer("engine-update:status", status);
  });
  engineUpdater.init();

  // App self-update (electron-updater). No-op in dev / non-packaged. Reads
  // settings live so the autoUpdate toggle takes effect without restart.
  updater = new UpdaterService({ getSettings: () => cachedSettings as AppSettings });
  updater.on("status", (status: UpdateStatus) => {
    sendToRenderer("update:status", status);
  });
  updater.init();

  // Opt-in anonymous usage heartbeat. OFF by default; dormant until the user
  // enables it in Settings. Reads settings live so the toggle takes effect
  // without restart. See docs/TELEMETRY.md.
  usageReporting = new UsageReporting({
    getSettings: () => cachedSettings as AppSettings,
    statePath: join(dataRoot, "usage-state.json"),
  });
  usageReporting.start();

  // Per-profile extension management. Engine version feeds the Web Store CRX
  // endpoint's prodversion (falls back to a sane default before the runtime is
  // ready).
  extensionsService = new ExtensionsService({
    profileManager,
    extensionStoreRoot,
    engineVersion: () => {
      const s = chromiumBootstrap.getStatus();
      return s.kind === "ready" ? s.version : "145.0.0.0";
    },
  });

  browserDriver = new ChromiumBrowserDriver({
    profileManager,
    chromiumBootstrap,
    extensionStoreRoot,
    // FR-6 T2: ephemeral profiles materialize per-launch working copies here.
    runsRoot: join(dataRoot, "runs"),
    // Run-model: every running browser instance gets its OWN MCP control
    // endpoint (probed port + own token) serving a run-scoped tool set.
    // Built from the same profileManager/driver/activityLog as the
    // management-plane server, so tool calls still land in the live feed.
    createRunServer: (scope) =>
      createMultizenMcpServer({ profileManager, browserDriver, activityLog, scope }).server,
    // The companion's "Add to MultiZen" button routes here (profile-scoped).
    // Confirm natively first: any script on the store page could trigger the
    // channel, so an explicit OS dialog makes a drive-by install impossible.
    onCompanionInstall: (profileId, extensionId) => {
      // De-dupe: the companion logs the marker a few times to beat a race, so
      // ignore repeats of the same {profile,extension} within a short window.
      const dedupeKey = `${profileId}:${extensionId}`;
      if (recentCompanionInstalls.has(dedupeKey)) return;
      recentCompanionInstalls.add(dedupeKey);
      setTimeout(() => recentCompanionInstalls.delete(dedupeKey), 15000);
      void (async () => {
        const profile = profileManager.get(profileId);
        const choice = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          buttons: ["Add to MultiZen", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          message: "Add this extension to the profile?",
          detail: `Extension ${extensionId} will be installed into "${profile?.name ?? profileId}" and load on the next launch.`,
        });
        if (choice.response !== 0) return;
        try {
          const extension = await extensionsService.installFromWebStore(profileId, extensionId);
          sendToRenderer("extensions:installed", { ok: true, profileId, extension });
          // Apply immediately: Chromium only reads --load-extension at startup,
          // so relaunch the profile (reopens with its start page) instead of
          // making the user close + reopen it by hand.
          if (browserDriver.isRunning(profileId)) {
            await browserDriver.close(profileId).catch(() => {});
            await browserDriver.launch(profileId).catch((e: unknown) => {
              // The profile is now closed and didn't reopen — tell the user so
              // they're not left wondering where their browser went.
              sendToRenderer("extensions:installed", {
                ok: false,
                profileId,
                error: `Added it, but the profile didn't reopen — launch it again. (${(e as Error).message})`,
              });
            });
          }
        } catch (e) {
          sendToRenderer("extensions:installed", {
            ok: false,
            profileId,
            error: (e as Error).message,
          });
        }
      })();
    },
  });

  const mcp = createMultizenMcpServer({ profileManager, browserDriver });
  activityLog = mcp.activityLog;

  // Forward activity events to renderer
  activityLog.on("event", (e: ActivityEvent) => {
    sendToRenderer("activity:event", e);
  });

  // Forward profile running-state changes (manual launch, manual close,
  // and — most importantly — external Chromium close where the user quits
  // the browser window directly).
  browserDriver.on("running-changed", (change) => {
    sendToRenderer("profiles:running-changed", change);
  });

  // Background-probe proxies for profiles missing a cached country code
  // (existing rows from before the proxy_country migration, or rows where
  // the user changed proxy and we cleared the stale value). Runs once at
  // startup so the GUI flag chip reflects the proxy egress without forcing
  // the user to click "Test proxy" or relaunch.
  void backfillProxyCountries();

  // Optional embedded HTTP+SSE transport so external Cursor/Claude can connect
  if (cachedSettings.mcpHttpEnabled) {
    try {
      // Require a bearer token so only clients that hold the locally-stored
      // secret (not a random local process, not a DNS-rebinding web page) can
      // drive the browser-control tools. Generated + persisted 0600 on first run.
      mcpAuthToken = loadOrCreateMcpToken(userData);
      httpTransport = new HttpTransport({
        port: cachedSettings.mcpHttpPort,
        authToken: mcpAuthToken,
      });
      // Streamable HTTP builds a fresh MCP server per request; give it a factory
      // that reuses the same profileManager/browserDriver AND the shared
      // activityLog, so every transport's tool calls land in the one live feed.
      await httpTransport.start(
        () => createMultizenMcpServer({ profileManager, browserDriver, activityLog }).server,
      );
    } catch (e) {
      // Port collision when the port came from settings: keep upstream's
      // non-fatal behavior (log and continue without MCP).
      process.stderr.write(`MCP HTTP transport failed to start: ${String(e)}\n`);
      httpTransport = null;
      // FR-2: a port EXPLICITLY requested via --mcp-port / MULTIZEN_MCP_PORT
      // must not silently degrade to "app runs with no MCP" — scripted
      // multi-instance launches would look fine while being uncontrollable.
      // Fail loudly: dialog + non-zero exit.
      if (mcpPort.source === "cli" || mcpPort.source === "env") {
        dialog.showErrorBox(
          "MultiZen — MCP port unavailable",
          `This instance was started with MCP port ${mcpPort.port}, but that port is already in use.\n\n` +
            `Pick another port, e.g. --mcp-port=${mcpPort.port + 1}, or stop the process holding ${mcpPort.port}.\n\n` +
            `${String(e)}`,
        );
        app.exit(1);
        return;
      }
    }
  }

  // FR-6 T1: --import-profile=<file.mzar> + --import-passphrase=<pp> — bring a
  // profile archive into THIS instance at startup. Combines with
  // --launch-profile for scripted "import & run" launches of the same
  // identity across instances. Archives are always encrypted, so a missing
  // passphrase is a loud failure, not a prompt mid-script. Note: the
  // passphrase is visible in process listings — acceptable for local
  // orchestration tooling, documented in the requirements doc.
  if (instance.importProfile) {
    const archivePath = resolve(instance.importProfile);
    function fail(msg: string): never {
      process.stderr.write(`[multizen] --import-profile: ${msg}\n`);
      dialog.showErrorBox("MultiZen — profile import failed", `${msg}`);
      app.exit(1);
      throw new Error(msg);
    }
    if (!existsSync(archivePath)) {
      fail(`archive not found: ${archivePath}`);
    }
    if (!instance.importPassphrase) {
      fail("--import-passphrase is required — .mzar archives are always encrypted.");
    }
    try {
      const restored = await importProfile(
        archivePath,
        instance.importPassphrase,
        join(dataRoot, "profiles"),
        {
          idTaken: (id) => Boolean(profileManager.get(id)),
          extensionStoreRoot,
        },
      );
      const inserted = profileManager.insertImported(restored);
      process.stdout.write(
        `[multizen] --import-profile: imported "${inserted.name}" (${inserted.id})\n`,
      );
    } catch (e) {
      fail(`importing ${archivePath} failed: ${String(e)}`);
    }
  }

  // FR-8: --launch-profile=<id|name> — auto-launch the profile once settings,
  // driver and MCP transport are wired, so a scripted instance comes up
  // ready-to-drive with zero GUI interaction. browserDriver.launch() waits for
  // the Chromium engine (first run downloads it) before spawning.
  if (instance.launchProfile) {
    const wanted = instance.launchProfile;
    const profiles = profileManager.list();
    const target =
      profiles.find((p) => p.id === wanted) ??
      profiles.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
    if (!target) {
      dialog.showErrorBox(
        "MultiZen — profile not found",
        `--launch-profile "${wanted}" matches no profile in this instance ` +
          `(${instance.instanceId ?? "default"}, ${profiles.length} profile(s) present).\n\n` +
          `Pass a profile id or exact name, or drop the flag to start with the profile list.`,
      );
      app.exit(1);
      return;
    }
    process.stdout.write(`[multizen] --launch-profile: starting "${target.name}" (${target.id})\n`);
    void browserDriver.launch(target.id).catch((e: unknown) => {
      // Non-fatal: the app stays usable, the failure is surfaced clearly.
      process.stderr.write(`[multizen] --launch-profile failed: ${String(e)}\n`);
      dialog.showErrorBox(
        "MultiZen — profile failed to launch",
        `--launch-profile "${target.name}" (${target.id}) could not start:\n\n${String(e)}`,
      );
    });
  }

  // Profile IPC
  ipcMain.handle("profiles:list", () =>
    profileManager.list().map((p) => ({
      ...p,
      isRunning: browserDriver.isRunning(p.id),
      runCount: browserDriver.listRuns().filter((r) => r.profileId === p.id).length,
    })),
  );
  // Run-model IPC: every live browser instance + its own MCP connection info
  // (the MCP panel renders these so the user can copy an endpoint per run).
  ipcMain.handle("runs:list", () => browserDriver.listRuns());
  ipcMain.handle("runs:close", (_e, runId: string) => browserDriver.closeRun(runId));
  // In-browser screenshot: captures the instance's PAGE content via CDP
  // (viewport only, never the desktop — foreground windows can't occlude it).
  ipcMain.handle("runs:screenshot", (_e, runId: string) => browserDriver.screenshot(runId));
  ipcMain.handle("profiles:get", (_e, id: string) => profileManager.get(id));
  ipcMain.handle("profiles:create", (_e, input: Parameters<ProfileManager["create"]>[0]) =>
    profileManager.create(input),
  );
  ipcMain.handle(
    "profiles:update",
    (_e, id: string, patch: Parameters<ProfileManager["update"]>[1]) =>
      profileManager.update(id, patch),
  );
  ipcMain.handle("profiles:delete", (_e, id: string) => {
    void browserDriver.close(id).catch(() => {});
    profileManager.delete(id);
    // Reclaim shared store entries this profile referenced that no other profile
    // still uses (delete() only removed the profile's own dataDir). Best-effort.
    void sweepOrphans(
      extensionStoreRoot,
      profileManager.allExtensionRefs().map((r) => r.ext),
    ).catch(() => {});
  });
  ipcMain.handle("profiles:launch", (_e, id: string) => browserDriver.launch(id));
  ipcMain.handle("profiles:close", (_e, id: string) => browserDriver.close(id));
  // FR-6 T1: duplicate into a fresh id + dataDir. Refused while the source is
  // RUNNING — Chromium holds a write lock on its user-data-dir and mid-write
  // SQLite/LevelDB files would produce a corrupt copy.
  ipcMain.handle("profiles:duplicate", (_e, id: string) => {
    if (browserDriver.isRunning(id)) {
      throw new Error(
        `Profile is running — stop it before duplicating. ` +
          `Chromium keeps its profile files open and mid-write while alive; ` +
          `a copy taken now could be corrupt.`,
      );
    }
    return profileManager.duplicate(id);
  });

  // Settings IPC
  ipcMain.handle("settings:get", () => settingsStore.load());
  ipcMain.handle("settings:update", async (_e, patch: Partial<AppSettings>) => {
    cachedSettings = await settingsStore.update(patch);
    // The update returns FILE truth; a CLI/env --mcp-port override outranks
    // the file for this process's lifetime — re-apply it so system:info and
    // the MCP panel keep showing the port the transport actually bound.
    if (mcpPort.source === "cli" || mcpPort.source === "env") {
      cachedSettings = { ...cachedSettings, mcpHttpPort: mcpPort.port };
    }
    // Let the updaters react to their auto-update toggles without a restart.
    updater?.onSettingsChanged();
    engineUpdater?.onSettingsChanged();
    return cachedSettings;
  });

  // Activity IPC
  ipcMain.handle("activity:recent", () => activityLog.recent());

  // Chromium bootstrap IPC
  ipcMain.handle("chromium:status", () => chromiumBootstrap.getStatus());
  ipcMain.handle("chromium:retry", () =>
    engineCacheDir !== null
      ? withEngineInstallLock(engineCacheDir, () => chromiumBootstrap.ensure())
      : chromiumBootstrap.ensure(),
  );

  // Extensions IPC (per-profile)
  ipcMain.handle("extensions:list", (_e, profileId: string) =>
    extensionsService.list(profileId),
  );
  ipcMain.handle("extensions:addFromFile", async (_e, profileId: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: "Add extension (.crx or .zip)",
      properties: ["openFile"],
      filters: [{ name: "Chrome extension", extensions: ["crx", "zip"] }],
    });
    if (r.canceled || !r.filePaths[0]) return extensionsService.list(profileId);
    await extensionsService.installFromFile(profileId, r.filePaths[0]);
    return extensionsService.list(profileId);
  });
  ipcMain.handle("extensions:addFromFolder", async (_e, profileId: string) => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: "Add unpacked extension folder",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return extensionsService.list(profileId);
    await extensionsService.installFromFile(profileId, r.filePaths[0]);
    return extensionsService.list(profileId);
  });
  ipcMain.handle("extensions:addFromWebStore", async (_e, profileId: string, urlOrId: string) => {
    try {
      await extensionsService.installFromWebStore(profileId, urlOrId);
    } catch (e) {
      process.stderr.write(`[extensions] addFromWebStore FAILED: ${(e as Error).stack ?? (e as Error).message}\n`);
      throw e;
    }
    return extensionsService.list(profileId);
  });
  ipcMain.handle("extensions:remove", async (_e, profileId: string, extId: string) => {
    await extensionsService.remove(profileId, extId);
    return extensionsService.list(profileId);
  });
  ipcMain.handle(
    "extensions:toggle",
    (_e, profileId: string, extId: string, enabled: boolean) => {
      extensionsService.setEnabled(profileId, extId, enabled);
      return extensionsService.list(profileId);
    },
  );

  // Staging IPC (no profile id yet) — used by the create sheet to attach or
  // install extensions before the profile exists. `prepare*` unpack into the
  // shared store and return the single ref; the renderer holds the staged list
  // and passes it to profiles:create as `extensions`.
  // Shared staging helper: unpack a local source into the store, logging
  // failures like prepareFromWebStore does (the dialogs above call this).
  const prepareStaged = async (sourcePath: string): Promise<ExtensionConfig | null> => {
    try {
      return await extensionsService.prepareFromFile(sourcePath);
    } catch (e) {
      process.stderr.write(
        `[extensions] prepareFromFile FAILED: ${(e as Error).stack ?? (e as Error).message}\n`,
      );
      throw e;
    }
  };

  ipcMain.handle("extensions:storeEntries", () => extensionsService.storeEntries());
  // Real icon from an extension's own manifest, as a data URI (or null → the
  // renderer shows the generic glyph). Lets non-catalog extensions show their
  // actual icon. Shared entries resolve from the store; profile-scoped ones
  // need the owning profile's dataDir.
  ipcMain.handle(
    "extensions:icon",
    async (_e, ext: ExtensionConfig, profileId: string | null): Promise<string | null> => {
      const dataDir = profileId ? profileManager.get(profileId)?.dataDir : undefined;
      if (ext.scope !== "shared" && !dataDir) return null;
      const dir = resolveLoadDir(ext, dataDir ?? "", extensionStoreRoot);
      // Defense-in-depth: a crafted archive could carry a profile-scope ext.dir
      // that escapes the profile. Keep the resolved dir inside its expected root
      // before reading any file from it.
      const root = resolve(ext.scope === "shared" ? extensionStoreRoot : (dataDir ?? ""));
      const abs = resolve(dir);
      if (abs !== root && !abs.startsWith(root + sep)) return null;
      return readManifestIcon(abs);
    },
  );
  ipcMain.handle("extensions:prepareFromWebStore", async (_e, urlOrId: string) => {
    try {
      return await extensionsService.prepareFromWebStore(urlOrId);
    } catch (e) {
      process.stderr.write(
        `[extensions] prepareFromWebStore FAILED: ${(e as Error).stack ?? (e as Error).message}\n`,
      );
      throw e;
    }
  });
  ipcMain.handle("extensions:prepareFromFile", async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: "Add extension (.crx or .zip)",
      properties: ["openFile"],
      filters: [{ name: "Chrome extension", extensions: ["crx", "zip"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return prepareStaged(r.filePaths[0]);
  });
  ipcMain.handle("extensions:prepareFromFolder", async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: "Add unpacked extension folder",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return prepareStaged(r.filePaths[0]);
  });

  // App self-update IPC
  ipcMain.handle("update:status", () => updater.getStatus());
  ipcMain.handle("update:lastChecked", () => updater.getLastCheckedAt());
  ipcMain.handle("update:check", () => updater.checkForUpdates({ manual: true }));
  ipcMain.handle("update:install", () => updater.installAndRestart());
  ipcMain.handle("update:download", (_e, version: string) =>
    shell.openExternal(updater.downloadUrlFor(version)),
  );

  // Browser-engine update IPC (distinct from the app self-update above).
  ipcMain.handle("engine-update:status", () => engineUpdater.getStatus());
  ipcMain.handle("engine-update:check", () => engineUpdater.checkOnly());
  ipcMain.handle("engine-update:install", () => engineUpdater.updateNow());

  // Fingerprint generator IPC — called from create + edit forms when the
  // user hits Regen. Returns a fresh, internally-consistent preset.
  ipcMain.handle("fingerprint:generate", () => generateFingerprint());
  ipcMain.handle("fingerprint:devices", () => deviceCatalog());
  ipcMain.handle("fingerprint:locales", () => localeCatalog());
  ipcMain.handle("fingerprint:localeForCountry", (_e, cc: string) =>
    findLocaleIdByCountry(cc),
  );
  ipcMain.handle(
    "fingerprint:reconcile",
    (
      _e,
      current: Parameters<typeof reconcileFingerprint>[0],
      patch: Parameters<typeof reconcileFingerprint>[1],
    ) => {
      // reconcileFingerprint now throws on invalid input (the honest contract
      // for MCP). GUI patches are all catalog-sourced so this "can't happen"
      // in normal use, but the renderer calls this as `void reconcile(...)`,
      // so a throw would surface as an unhandled rejection and silently no-op
      // the edit. Degrade gracefully: on a reconcile rejection (e.g. a corrupt
      // or legacy persisted fingerprint) return `current` unchanged; rethrow
      // anything else.
      try {
        return reconcileFingerprint(current, patch);
      } catch (e) {
        if (e instanceof FingerprintReconcileError) {
          console.warn("[multizen] fingerprint reconcile rejected:", e.message);
          return current;
        }
        throw e;
      }
    },
  );

  // Proxy geo-IP probe — verifies that the profile's locale + timezone are
  // coherent with the proxy IP's country. Detection vendors flag mismatches
  // like "Accept-Language: ru-RU + IP in US" as suspicious.
  ipcMain.handle(
    "proxy:detectGeo",
    async (
      _e,
      proxy: ProxyConfig,
      profileId?: string,
    ): Promise<{ ok: true; geo: ProxyGeoResult } | { ok: false; error: string }> => {
      try {
        const geo = await probeProxyGeo(proxy);
        // Persist the resolved country onto the profile (if one was given)
        // so the GUI flag chip can render it without waiting for next
        // launch. Lower-cased for the flag-icons CSS class.
        if (profileId && geo.country) {
          profileManager.setProxyCountry(profileId, geo.country.toLowerCase());
        }
        return { ok: true, geo };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // Profile import / export
  ipcMain.handle(
    "profiles:export",
    async (_e, id: string, passphrase: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> => {
      const profile = profileManager.get(id);
      if (!profile) return { ok: false, reason: "not_found" };
      const result = await dialog.showSaveDialog(mainWindow ?? undefined!, {
        title: "Export profile",
        defaultPath: `${profile.name.replace(/[^a-z0-9-_]+/gi, "_")}.mzar`,
        filters: [{ name: "MultiZen archive", extensions: ["mzar"] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, reason: "cancelled" };
      // Bundle the profile's shared-store extensions so importing on another
      // machine restores the extension code too, not just a dangling reference.
      const extensions = (profile.extensions ?? [])
        .filter((e) => e.scope === "shared")
        .map((e) => ({
          id: e.id,
          version: e.version,
          dir: storeEntryDir(extensionStoreRoot, e.id, e.version),
        }));
      await exportProfile(profile, passphrase, result.filePath, { extensions });
      return { ok: true, path: result.filePath };
    },
  );

  ipcMain.handle(
    "profiles:import",
    async (_e, passphrase: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined!, {
        title: "Import profile",
        filters: [{ name: "MultiZen archive", extensions: ["mzar"] }],
        properties: ["openFile"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, reason: "cancelled" };
      }
      const archivePath = result.filePaths[0];
      if (!archivePath) return { ok: false, reason: "cancelled" };
      try {
        // Restore the full user-data-dir to disk. If the archive's id already
        // exists here, importProfile mints a fresh id + dataDir so it never
        // overwrites the existing profile. The returned Profile carries every
        // field (extensions, icon, startUrl, searchProvider, fingerprint,
        // proxy) and its dataDir points at the restored files.
        const restored = await importProfile(archivePath, passphrase, join(dataRoot, "profiles"), {
          idTaken: (id) => Boolean(profileManager.get(id)),
          // Restore bundled (v2) extensions into the shared store so they work
          // on this machine without the user re-adding them.
          extensionStoreRoot,
        });
        // Insert the row verbatim so the DB entry points at the restored files
        // (the old create()-based path minted a new id/dataDir and orphaned the
        // cookies/logins that were just restored).
        const inserted = profileManager.insertImported(restored);
        return { ok: true, id: inserted.id };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
  );

  // System info
  ipcMain.handle("system:info", () => ({
    // FR-7: which instance answered — shown in the MCP panel so multi-agent
    // setups can tell their endpoints apart.
    instanceId: instance.instanceId,
    mcpHttpUrl: httpTransport ? `http://127.0.0.1:${cachedSettings?.mcpHttpPort}` : null,
    // Bearer token an MCP client must send as `Authorization: Bearer <token>`.
    // Surfaced so the in-app panel can show a ready-to-paste client config.
    mcpAuthToken: httpTransport ? mcpAuthToken : null,
    appVersion: app.getVersion(),
    platform: process.platform,
  }));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e: unknown) => {
  // A failure anywhere in the async startup would otherwise reject SILENTLY:
  // createWindow() is the last step, so the dock icon appears but no window and
  // no error ever shows. The known trigger is the native better-sqlite3 binding
  // failing to load when a wrong-arch .node ships (an arm64 binary in the x64
  // build → crashes on Intel Macs). Surface it as a visible dialog and quit
  // cleanly instead of a mystery no-window.
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`[multizen] fatal startup error:\n${detail}\n`);
  dialog.showErrorBox(
    "MultiZen failed to start",
    `A startup step failed:\n\n${e instanceof Error ? e.message : String(e)}\n\n` +
      "Please report this on Discord/GitHub with this message.",
  );
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Probe geo for every profile that has a proxy but no cached country code
 * yet. Each probe takes ~1-3s; we run them sequentially so we don't hammer
 * the same upstream proxy with parallel requests, and emit a renderer
 * event after each one so the flag chip updates as soon as the result
 * lands. Failures are non-fatal — the next launch will re-probe.
 */
async function backfillProxyCountries(): Promise<void> {
  if (!profileManager) return;
  const profiles = profileManager.list();
  for (const summary of profiles) {
    if (!summary.proxy || summary.proxyCountry) continue;
    try {
      const geo = await probeProxyGeo(summary.proxy, { timeoutMs: 6000 });
      if (geo.country) {
        profileManager.setProxyCountry(summary.id, geo.country.toLowerCase());
        // Nudge the renderer so it refetches the list and re-renders flags.
        sendToRenderer("profiles:proxy-country-updated", {
          id: summary.id,
          country: geo.country.toLowerCase(),
        });
      }
    } catch {
      // Proxy down / probe service rate-limited — skip silently.
    }
  }
}

app.on("before-quit", async (e) => {
  e.preventDefault();
  try {
    await browserDriver?.closeAll();
    await httpTransport?.stop();
    profileManager?.close();
  } finally {
    app.exit(0);
  }
});
