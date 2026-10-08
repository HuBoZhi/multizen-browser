import Database from "better-sqlite3";
import { existsSync, promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import { SKIPPED_ON_DUPLICATE } from "./ProfileManager.js";

/**
 * Run → profile identity sync (FR-6 T2, revised run model).
 *
 * Every run executes on a private working copy of the profile dir, and the
 * profile dir ("main repo") is thereafter written ONLY by the host process —
 * a live browser never holds it open. That makes the main repo permanently
 * lock-free: the launch-time copy is always complete (a live Chromium keeps
 * its Cookies DB open WITHOUT read-sharing on Windows, which used to make
 * sibling-run copies boot logged-out), and this module can merge a finished
 * run's identity changes back the moment its browser process has exited and
 * released its file handles.
 *
 * Two write-back layers:
 *  - Cookies: row-level merge guarded by `last_access_utc`, so concurrent
 *    runs of one profile converge instead of clobbering each other, and a
 *    logout inside the run propagates as a deletion (checked against the
 *    launch-time baseline so a sibling-refreshed row is never resurrected).
 *  - Everything else identity-bearing (Local Storage, IndexedDB, passwords,
 *    autofill, preferences, extensions, history, service workers): wholesale
 *    file copy-back, performed only by the LAST live run of the profile to
 *    exit. Those stores can't be row-merged, so earlier exits skip rather
 *    than overwrite a still-running sibling with stale files.
 *
 * Ephemeral profiles never sync back — the template stays pristine.
 */

/** Dirs/files that must never flow back into the profile dir. Superset of
 *  the copy-time skip list: caches and crash reports are regenerable, the
 *  singleton trio is per-process state, and Sessions / Session Storage are
 *  per-run tab state that the "launch fresh" model deliberately drops. */
const NEVER_SYNC_BACK = new Set([...SKIPPED_ON_DUPLICATE, "Sessions", "Session Storage"]);

/** Chromium keeps cookies — PK (host_key, top_frame_site_key, name, path) —
 *  in this file, held open with no read-sharing while its browser is alive. */
const COOKIE_DB = join("Default", "Network", "Cookies");

const COOKIE_DB_SIDECARS = ["-journal", "-wal", "-shm"];

function isSkippedRelPath(rel: string, name: string): boolean {
  if (NEVER_SYNC_BACK.has(name)) return true;
  // The cookie DB is merged row-level above; a file-level copy would clobber
  // a sibling run's freshly merged rows.
  const norm = rel.split("\\").join("/").toLowerCase();
  return norm === "default/network/cookies" || norm.startsWith("default/network/cookies-");
}

/** PK + last_access_utc snapshot of the cookie DB a run starts from. An
 *  absent DB (first-ever run of a fresh profile) yields an empty map. */
export type CookieBaseline = Map<string, number>;

export function captureCookieBaseline(browserDataDir: string): CookieBaseline {
  const out: CookieBaseline = new Map();
  const dbPath = join(browserDataDir, COOKIE_DB);
  if (!existsSync(dbPath)) return out;
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return out;
  }
  try {
    const rows = db
      .prepare("SELECT host_key, top_frame_site_key, name, path, last_access_utc FROM cookies")
      .all() as Array<CookieKeyRow & { last_access_utc: number }>;
    for (const r of rows) out.set(cookieKey(r), r.last_access_utc);
  } catch (e) {
    console.warn("[multizen] cookie baseline capture failed:", (e as Error).message);
  } finally {
    db.close();
  }
  return out;
}

interface CookieKeyRow {
  host_key: string;
  top_frame_site_key: string;
  name: string;
  path: string;
}

function cookieKey(r: CookieKeyRow): string {
  return `${r.host_key}\u0000${r.top_frame_site_key}\u0000${r.name}\u0000${r.path}`;
}

export interface SyncRunOptions {
  /** The run's working copy root (e.g. `<runsRoot>/<runId>`). */
  runDir: string;
  /** The profile's persistent data root (the sync-back target). */
  profileDir: string;
  /** Engine-scoped browser data dirs (run side / profile side) — cookie
   *  merges happen between these (e.g. `<root>/engines/cloakbrowser`). */
  runDataDir: string;
  profileDataDir: string;
  /** Cookie snapshot from launch; enables logout (deletion) propagation. */
  baseline?: CookieBaseline;
  /** false for ephemeral profiles — the profile dir is never touched. */
  syncBack: boolean;
  /** true when this run is the last live one of its profile → the wholesale
   *  copy-back of non-cookie stores is allowed. */
  isLastRun: boolean;
}

/**
 * Merge one finished run back into its profile dir. Never throws: every
 * failure is logged and the caller still deletes the working copy (a failed
 * sync loses that run's newest identity changes; it must never wedge
 * disposal or leave run dirs behind).
 */
export async function syncRunIntoProfile(opts: SyncRunOptions): Promise<void> {
  if (!opts.syncBack) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await mergeRunCookies(opts.runDataDir, opts.profileDataDir, opts.baseline);
      console.log(
        `[multizen] cookie merge ${res.status} (+${res.upserted} / -${res.deleted}) → ${opts.profileDir}`,
      );
      break;
    } catch (e) {
      if (attempt >= 3 || !isTransientLockError(e)) {
        console.error(`[multizen] cookie merge failed:`, (e as Error).message);
        break;
      }
      await sleep(800);
    }
  }
  if (!opts.isLastRun) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const files = await copyBackRunTree(opts.runDir, opts.profileDir);
      console.log(`[multizen] profile copy-back: ${files} file(s) ← ${opts.runDir}`);
      break;
    } catch (e) {
      if (attempt >= 3 || !isTransientLockError(e)) {
        console.error(`[multizen] profile copy-back failed:`, (e as Error).message);
        break;
      }
      await sleep(800);
    }
  }
}

type MergeStatus = "merged" | "bootstrap-copy" | "missing-run-db" | "skipped-schema";

interface MergeResult {
  status: MergeStatus;
  upserted: number;
  deleted: number;
}

/**
 * Merge the run's cookie rows into the profile's cookie DB. Both files are
 * unlocked by contract (the run's browser has exited; only the host ever
 * writes the profile side) — throws on surprises so the caller can retry
 * transient lock errors, returns a status for the deliberate no-op cases.
 */
async function mergeRunCookies(
  runDataDir: string,
  profileDataDir: string,
  baseline: CookieBaseline | undefined,
): Promise<MergeResult> {
  const runDbPath = join(runDataDir, COOKIE_DB);
  if (!existsSync(runDbPath)) {
    return { status: "missing-run-db", upserted: 0, deleted: 0 };
  }
  const profileDbPath = join(profileDataDir, COOKIE_DB);
  if (!existsSync(profileDbPath)) {
    // First-ever sync: the run's file is authoritative and neither side is
    // open by a browser — take it wholesale. Encrypted cookie blobs stay
    // valid: the run's os_crypt key IS the profile's (it was copied from
    // here at launch).
    await fsp.mkdir(dirname(profileDbPath), { recursive: true });
    await fsp.copyFile(runDbPath, profileDbPath);
    for (const suffix of COOKIE_DB_SIDECARS) {
      const src = runDbPath + suffix;
      if (existsSync(src)) await fsp.copyFile(src, profileDbPath + suffix).catch(() => {});
    }
    return { status: "bootstrap-copy", upserted: 0, deleted: 0 };
  }
  return withCookieMergeLock(profileDbPath, () =>
    mergeRunCookiesLocked(runDbPath, profileDbPath, baseline),
  );
}

// Serialize merges per profile DB — sibling runs can exit near-simultaneously
// and both would otherwise open the same SQLite file for writing.
const mergeQueues = new Map<string, Promise<unknown>>();

function withCookieMergeLock<T>(key: string, fn: () => T): Promise<T> {
  const prev = mergeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mergeQueues.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

function mergeRunCookiesLocked(
  runDbPath: string,
  profileDbPath: string,
  baseline: CookieBaseline | undefined,
): MergeResult {
  const run = new Database(runDbPath, { readonly: true, fileMustExist: true });
  try {
    const profile = new Database(profileDbPath, { fileMustExist: true });
    try {
      profile.pragma("busy_timeout = 4000");
      // Schema guard: an engine update between run start and exit migrates
      // the run's cookie DB (meta.version); merging across versions would
      // copy wrong-shaped rows. Equal versions guarantee identical shape.
      const runVer = cookieDbVersion(run);
      const profileVer = cookieDbVersion(profile);
      if (runVer === null || profileVer === null || runVer !== profileVer) {
        return { status: "skipped-schema", upserted: 0, deleted: 0 };
      }

      let upserted = 0;
      let deleted = 0;

      // Rows the run's browser (re)wrote more recently than whatever the
      // profile dir currently holds. Sibling runs that exited earlier have
      // already landed their rows, so this converges instead of the last
      // writer blindly overwriting fresher state. (ATTACH must precede the
      // statement prepare AND the transaction — SQLite forbids both in the
      // other order.)
      profile.prepare("ATTACH DATABASE ? AS rundb").run(runDbPath);
      try {
        const upsert = profile.prepare(`
          INSERT OR REPLACE INTO main.cookies
          SELECT r.* FROM rundb.cookies r
          WHERE r.last_access_utc >= COALESCE((
              SELECT c.last_access_utc FROM main.cookies c
              WHERE c.host_key = r.host_key
                AND c.top_frame_site_key = r.top_frame_site_key
                AND c.name = r.name
                AND c.path = r.path
            ), -1)
        `);

        const tx = profile.transaction(() => {
          upserted = upsert.run().changes;
          if (baseline && baseline.size > 0) {
            // Logout propagation: a baseline row that vanished inside the
            // run was deleted by it — but only honor that if the profile's
            // current row is still exactly the baseline one (a sibling may
            // have refreshed it since; never resurrect, never clobber).
            const runKeys = new Set<string>(
              (
                run
                  .prepare("SELECT host_key, top_frame_site_key, name, path FROM cookies")
                  .all() as CookieKeyRow[]
              ).map(cookieKey),
            );
            const lookup = profile.prepare(
              `SELECT last_access_utc FROM main.cookies
               WHERE host_key = ? AND top_frame_site_key = ? AND name = ? AND path = ?`,
            );
            const del = profile.prepare(
              `DELETE FROM main.cookies
               WHERE host_key = ? AND top_frame_site_key = ? AND name = ? AND path = ?
                 AND last_access_utc = ?`,
            );
            for (const [key, baseAccess] of baseline) {
              if (runKeys.has(key)) continue;
              const parts = key.split("\u0000");
              const row = lookup.get(...parts) as { last_access_utc: number } | undefined;
              if (row && row.last_access_utc === baseAccess) {
                deleted += del.run(parts[0], parts[1], parts[2], parts[3], baseAccess).changes;
              }
            }
          }
        });
        tx();
        return { status: "merged", upserted, deleted };
      } finally {
        profile.exec("DETACH DATABASE rundb");
      }
    } finally {
      profile.close();
    }
  } finally {
    run.close();
  }
}

function cookieDbVersion(db: Database.Database): string | null {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
      | { value?: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Wholesale copy-back of the run's working tree onto the profile dir.
 * Copy-over only — profile files the run lacks (e.g. a pruned cache) are
 * left as harmless debris rather than tracked for deletion. Skips everything
 * in NEVER_SYNC_BACK plus the cookie DB (row-merged above).
 */
export async function copyBackRunTree(runDir: string, profileDir: string): Promise<number> {
  let copied = 0;
  const walk = async (srcDir: string, dstDir: string, rel: string): Promise<void> => {
    const entries = await fsp.readdir(srcDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (isSkippedRelPath(childRel, entry.name)) continue;
      const src = join(srcDir, entry.name);
      const dst = join(dstDir, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(dst, { recursive: true }).catch(() => {});
        await walk(src, dst, childRel);
        continue;
      }
      try {
        if (!(await fsp.stat(src)).isFile()) continue;
        await fsp.copyFile(src, dst);
        copied++;
      } catch {
        // Vanished mid-walk or transiently locked — skip; the run dir is
        // deleted after this anyway.
      }
    }
  };
  await walk(runDir, profileDir, "");
  return copied;
}

function isTransientLockError(e: unknown): boolean {
  const err = e as Error & { code?: string };
  if (
    err.code === "SQLITE_BUSY" ||
    err.code === "SQLITE_BUSY_SNAPSHOT" ||
    err.code === "SQLITE_LOCKED"
  ) {
    return true;
  }
  // Windows: the just-exited browser's handles can linger a beat; copy/open
  // then fails with a sharing violation.
  return /EBUSY|EPERM|EACCES|resource busy|being used by another process|locked/i.test(
    `${err.code ?? ""} ${err.message}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
