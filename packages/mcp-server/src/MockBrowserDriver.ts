import type { BrowserDriver } from "./server.js";
import type { LaunchedProfile, ProfileId, RunInfo } from "@multizen/types";

/**
 * In-memory browser driver for development. Returns plausible mock data
 * so MCP clients can be tested end-to-end before the real Chromium driver
 * is hooked up.
 *
 * Run model matches the real driver: one browser process = one run; a
 * profile may have several. Run ids are synthetic but flow through the
 * same runId-addressed operation surface.
 */
export class MockBrowserDriver implements BrowserDriver {
  private readonly running = new Map<
    string,
    { profileId: ProfileId; url: string; pid: number; port: number; startedAt: string }
  >();
  private port = 9222;

  async launch(profileId: ProfileId): Promise<LaunchedProfile> {
    this.port += 1;
    const pid = Math.floor(Math.random() * 100000) + 1000;
    const runId = `${profileId}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    this.running.set(runId, { profileId, url: "about:blank", pid, port: this.port, startedAt });
    return {
      id: profileId,
      runId,
      cdpEndpoint: `ws://localhost:${this.port}/devtools/browser/mock-${runId}`,
      pid,
      startedAt,
    };
  }

  async close(profileId: ProfileId): Promise<void> {
    for (const [runId, r] of [...this.running]) {
      if (r.profileId === profileId) this.running.delete(runId);
    }
  }

  async settleProfile(profileId: ProfileId): Promise<void> {
    // Mock runs have no on-disk sync-back — closing IS settling.
    await this.close(profileId);
  }

  async closeRun(runId: string): Promise<void> {
    this.running.delete(runId);
  }

  isRunning(profileId: ProfileId): boolean {
    return [...this.running.values()].some((r) => r.profileId === profileId);
  }

  listRuns(): RunInfo[] {
    return [...this.running.entries()].map(([runId, r]) => ({
      runId,
      profileId: r.profileId,
      startedAt: r.startedAt,
      cdpEndpoint: `ws://localhost:${r.port}/devtools/browser/mock-${runId}`,
      pid: r.pid,
      mcpPort: 0,
      mcpEndpoint: "(mock — no per-run transport)",
      mcpToken: "mock",
      ephemeral: false,
    }));
  }

  async navigate(runId: string, url: string): Promise<{ url: string }> {
    const r = this.running.get(runId);
    if (!r) throw new Error("not running");
    r.url = url;
    return { url };
  }

  async click(_runId: string, _selector: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  async type(_runId: string, _selector: string, _text: string): Promise<{ ok: true }> {
    return { ok: true };
  }

  async extract(_runId: string): Promise<{ result: unknown }> {
    return {
      result: {
        note: "mock extraction — real implementation returns the page accessibility tree",
        url: "about:blank",
        title: "",
      },
    };
  }

  async screenshot(_runId: string): Promise<{ pngBase64: string }> {
    return {
      pngBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    };
  }

  async cdpSend(
    runId: string,
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    opts?: { safe?: boolean },
  ): Promise<unknown> {
    const r = this.running.get(runId);
    if (!r) throw new Error("not running");
    // Echo the request back so MCP clients can exercise the CDP tool surfaces
    // end-to-end against the mock without a real browser.
    return {
      mock: true,
      method,
      params: params ?? {},
      sessionId: sessionId ?? null,
      safe: opts?.safe ?? true,
    };
  }
}
