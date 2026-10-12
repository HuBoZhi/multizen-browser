import type { BrowserWindowScreen } from "@multizen/settings-store";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DisplayArea {
  id: number;
  bounds: Rect;
  workArea: Rect;
}

export interface BrowserWindowPreferences {
  screen: BrowserWindowScreen;
  maximized: boolean;
  appDisplayId?: number;
}

/** Resolve against the current display topology on every launch (DIP coordinates). */
export function browserWindowPlacement(
  preferences: BrowserWindowPreferences,
  size: { width: number; height: number },
  displays: readonly DisplayArea[],
  primary: DisplayArea,
): Rect {
  const ordered = [...displays].sort(
    (a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y || a.id - b.id,
  );
  let display = primary;
  if (preferences.screen === "leftmost") display = ordered[0] ?? primary;
  if (preferences.screen === "rightmost") display = ordered.at(-1) ?? primary;
  if (preferences.screen === "app") {
    display = displays.find((d) => d.id === preferences.appDisplayId) ?? primary;
  }
  const area = display.workArea;
  const width = Math.min(Math.max(1, Math.round(size.width)), area.width);
  const height = Math.min(Math.max(1, Math.round(size.height)), area.height);
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height,
  };
}

interface WindowSession {
  cdpSend(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Override Chromium's saved geometry; state and geometry must be sent separately. */
export async function applyBrowserWindowPlacement(
  session: WindowSession,
  placement: Rect,
  maximized: boolean,
): Promise<void> {
  const { windowId, bounds } = (await session.cdpSend("Browser.getWindowForTarget")) as {
    windowId: number;
    bounds: { windowState: string };
  };
  if (bounds.windowState !== "normal") {
    await session.cdpSend("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
  }
  await session.cdpSend("Browser.setWindowBounds", {
    windowId,
    bounds: {
      left: placement.x,
      top: placement.y,
      width: placement.width,
      height: placement.height,
    },
  });
  if (maximized) {
    await session.cdpSend("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "maximized" },
    });
  }
}
