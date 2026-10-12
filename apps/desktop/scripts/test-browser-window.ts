import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsStore } from "../../../packages/settings-store/src/index.ts";
import {
  applyBrowserWindowPlacement,
  browserWindowPlacement,
} from "../src/main/browserWindowPlacement.ts";

const primary = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const left = {
  id: 2,
  bounds: { x: -1280, y: -200, width: 1280, height: 1024 },
  workArea: { x: -1280, y: -160, width: 1280, height: 984 },
};
const right = {
  id: 3,
  bounds: { x: 1920, y: 0, width: 1536, height: 864 },
  workArea: { x: 1920, y: 0, width: 1536, height: 824 },
};

test("selects physical left/right screens regardless of enumeration order and handles negative coordinates", () => {
  const displays = [right, primary, left];
  assert.deepEqual(
    browserWindowPlacement(
      { screen: "leftmost", maximized: false },
      { width: 4000, height: 2000 },
      displays,
      primary,
    ),
    { x: -1280, y: -160, width: 1280, height: 984 },
  );
  assert.deepEqual(
    browserWindowPlacement(
      { screen: "rightmost", maximized: false },
      { width: 1000, height: 600 },
      displays,
      primary,
    ),
    { x: 2188, y: 112, width: 1000, height: 600 },
  );
});

test("follows the app display and falls back to primary when it is unavailable", () => {
  const size = { width: 1000, height: 600 };
  assert.equal(
    browserWindowPlacement(
      { screen: "app", appDisplayId: 2, maximized: true },
      size,
      [primary, left],
      primary,
    ).x,
    -1140,
  );
  for (const screen of ["primary", "app", "leftmost", "rightmost"] as const) {
    assert.deepEqual(
      browserWindowPlacement(
        { screen, appDisplayId: 2, maximized: false },
        size,
        [primary],
        primary,
      ),
      { x: 460, y: 220, width: 1000, height: 600 },
    );
  }
});

test("restores a saved maximized window, moves it, then maximizes on the chosen screen", async () => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const session = {
    async cdpSend(method: string, params?: Record<string, unknown>): Promise<unknown> {
      calls.push({ method, params });
      return { windowId: 7, bounds: { windowState: "maximized" } };
    },
  };
  await applyBrowserWindowPlacement(session, { x: -1280, y: -160, width: 1000, height: 600 }, true);
  assert.deepEqual(calls, [
    { method: "Browser.getWindowForTarget", params: undefined },
    {
      method: "Browser.setWindowBounds",
      params: { windowId: 7, bounds: { windowState: "normal" } },
    },
    {
      method: "Browser.setWindowBounds",
      params: { windowId: 7, bounds: { left: -1280, top: -160, width: 1000, height: 600 } },
    },
    {
      method: "Browser.setWindowBounds",
      params: { windowId: 7, bounds: { windowState: "maximized" } },
    },
  ]);
  calls.length = 0;
  await applyBrowserWindowPlacement(session, { x: 0, y: 0, width: 1000, height: 600 }, false);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].params, { windowId: 7, bounds: { windowState: "normal" } });
});

test("migrates old settings, persists preferences and rejects malformed values", async () => {
  const dir = mkdtempSync(join(tmpdir(), "multizen-window-test-"));
  const path = join(dir, "settings.json");
  try {
    writeFileSync(path, JSON.stringify({ theme: "dark" }));
    const store = new SettingsStore(path);
    const initial = await store.load();
    assert.equal(initial.browserWindowScreen, "primary");
    assert.equal(initial.browserWindowMaximized, false);
    await store.update({ browserWindowScreen: "rightmost", browserWindowMaximized: true });
    const reloaded = await new SettingsStore(path).load();
    assert.equal(reloaded.browserWindowScreen, "rightmost");
    assert.equal(reloaded.browserWindowMaximized, true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).browserWindowScreen, "rightmost");
    const invalid = { browserWindowScreen: "removed-monitor", browserWindowMaximized: "true" };
    const repaired = await store.update(invalid as never);
    assert.equal(repaired.browserWindowScreen, "primary");
    assert.equal(repaired.browserWindowMaximized, false);
    writeFileSync(path, JSON.stringify(invalid));
    const repairedLoad = await new SettingsStore(path).load();
    assert.equal(repairedLoad.browserWindowScreen, "primary");
    assert.equal(repairedLoad.browserWindowMaximized, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
