import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Cross-process install lock for the SHARED Chromium engine cache (FR-3).
 *
 * The engine cache directory is shared by every MultiZen instance on the
 * machine. ChromiumBootstrap's own install pipeline is already safe against
 * concurrent runs at the file level (downloads/extracts land in `.partial`
 * siblings and are renamed into place atomically), but two instances cold-
 * starting at the same time would BOTH download ~560 MB before either
 * rename lands. This lock serializes that first download: the winner
 * installs while losers poll the lock, then hit the bootstrap's cache fast
 * path once the winner is done.
 *
 * Lock file: `<cacheDir>/install.lock` containing `{pid, ts}` JSON.
 *   - Acquired with an exclusive "wx" create (atomic on NTFS and POSIX).
 *   - A lock whose holder PID is dead (crash) or older than STALE_MS gets
 *   stolen.
 *   - Waiters poll every POLL_MS up to WAIT_TIMEOUT_MS, then proceed WITHOUT
 *   the lock — late arrival degrades to the (safe) duplicate-download race,
 *   never to a hang.
 */

const LOCK_NAME = "install.lock";
const STALE_MS = 30 * 60 * 1000;
const POLL_MS = 2000;
const WAIT_TIMEOUT_MS = 15 * 60 * 1000;

interface LockInfo {
  pid: number;
  ts: number;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = exists but not ours (visible on Windows for other users'
    // processes); ESRCH = gone.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown; ts?: unknown };
    if (typeof parsed.pid !== "number" || typeof parsed.ts !== "number") return null;
    return { pid: parsed.pid, ts: parsed.ts };
  } catch {
    return null;
  }
}

/** Try to take the lock; steals it from dead holders or stale files. */
async function tryAcquire(lockPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        await fh.writeFile(`${JSON.stringify({ pid: process.pid, ts: Date.now() })}\n`);
      } finally {
        await fh.close();
      }
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Someone holds it. Dead holder or stale (>STALE_MS) file → steal once.
    const info = await readLock(lockPath);
    let steal = info === null; // unreadable garbage → replace it
    if (info !== null) {
      let age = Date.now() - info.ts;
      try {
        age = Math.max(age, Date.now() - (await stat(lockPath)).mtimeMs);
      } catch {
        // vanished between read and stat — next attempt's "wx" will tell
      }
      steal = !isPidAlive(info.pid) || age > STALE_MS;
    }
    if (!steal) return false;
    await rm(lockPath, { force: true });
  }
  return false;
}

/**
 * Run `fn` while holding the engine install lock for `cacheDir`. See the
 * module doc for the wait/steal/timeout semantics.
 */
export async function withEngineInstallLock<T>(cacheDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(cacheDir, { recursive: true });
  const lockPath = join(cacheDir, LOCK_NAME);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let owned = false;
  while (!(owned = await tryAcquire(lockPath))) {
    if (Date.now() > deadline) {
      process.stderr.write(
        `[multizen] engine install lock still held after ${Math.round(WAIT_TIMEOUT_MS / 60000)} min — proceeding unlocked (worst case: a duplicate download)\n`,
      );
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    return await fn();
  } finally {
    if (owned) await rm(lockPath, { force: true }).catch(() => {});
  }
}
