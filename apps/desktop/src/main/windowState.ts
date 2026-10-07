import { screen } from "electron";

/**
 * Window geometry persistence guard (FR-9b of the requirements doc).
 *
 * The one real way a restored window ends up OFF-SCREEN is a persisted
 * position on a monitor that no longer exists (unplugged display, changed
 * dock/taskbar, RDP session). Every restored geometry passes through
 * {@link clampWindowState} before being handed to BrowserWindow, so under any
 * monitor topology the title bar stays visible and draggable on some display.
 */

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** At least this much of the window must remain visible horizontally. */
const MIN_VISIBLE_WIDTH = 120;
/** The title bar band that must remain reachable for dragging. */
const MIN_VISIBLE_HEIGHT = 48;
/** Size floors when the persisted geometry itself is nonsensical. */
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  );
}

function centeredIn(workArea: Rect, width: number, height: number): Rect {
  const w = Math.min(Math.max(width, MIN_WIDTH), workArea.width);
  const h = Math.min(Math.max(height, MIN_HEIGHT), workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + (workArea.height - h) / 2),
    width: w,
    height: h,
  };
}

/**
 * Clamp a persisted window state into a visible work area:
 *   - No intersection with ANY display → center on the primary display
 *     (size capped to its work area).
 *   - Intersects something → clamp into the display with the largest overlap
 *     so the title bar stays on-screen, and cap size to that work area.
 * The maximized flag always passes through untouched.
 */
export function clampWindowState(state: WindowState): WindowState {
  const displays = screen.getAllDisplays();
  const bounds: Rect = { x: state.x, y: state.y, width: state.width, height: state.height };
  const workAreas = displays.map((d) => d.workArea);
  const visible = workAreas.some((wa) => rectsIntersect(bounds, wa));
  if (!visible) {
    const primary = screen.getPrimaryDisplay().workArea;
    const r = centeredIn(primary, state.width, state.height);
    return { ...r, maximized: state.maximized };
  }
  const wa = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(Math.max(state.width, MIN_WIDTH), wa.width);
  const height = Math.min(Math.max(state.height, MIN_HEIGHT), wa.height);
  const x = Math.min(Math.max(state.x, wa.x), wa.x + wa.width - MIN_VISIBLE_WIDTH);
  const y = Math.min(Math.max(state.y, wa.y), wa.y + wa.height - MIN_VISIBLE_HEIGHT);
  return { x, y, width, height, maximized: state.maximized };
}
