/**
 * Smoke test for the revised syncRunIntoProfile contract:
 *  1. ok:true on a clean merge, isLastRun evaluated AFTER the cookie merge
 *     (lazy), exactly once, only when it returns true does copy-back run.
 *  2. isLastRun()===false → no copy-back file lands in the profile dir.
 *  3. Cookie-merge failure (corrupt run DB) → {ok:false} → caller keeps dir.
 * Run: ELECTRON_RUN_AS_NODE=1 ../../apps/desktop/node_modules/.bin/electron scripts/smoke-sync.mjs
 */
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { syncRunIntoProfile } from "../dist/sync.js";

const root = join(tmpdir(), `mz-smoke-${Date.now()}`);
const runDir = join(root, "run");
const profileDir = join(root, "profile");
const COOKIE = join("Default", "Network", "Cookies");

function makeCookieDb(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`CREATE TABLE meta(key LONGVARCHAR PRIMARY KEY, value LONGVARCHAR);
           CREATE TABLE cookies(
             host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL DEFAULT '',
             name TEXT NOT NULL, path TEXT NOT NULL DEFAULT '/',
             creation_utc INTEGER NOT NULL, expires_utc INTEGER NOT NULL,
             last_access_utc INTEGER NOT NULL, encrypted_value BLOB,
             is_secure INTEGER DEFAULT 0, is_httponly INTEGER DEFAULT 0)`);
  db.prepare("INSERT INTO meta VALUES ('version','24')").run();
  const ins = db.prepare(
    "INSERT INTO cookies (host_key, top_frame_site_key, name, path, creation_utc, expires_utc, last_access_utc, encrypted_value) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const r of rows) ins.run(...r);
  db.close();
}

function rows(path) {
  const db = new Database(path, { readonly: true });
  const out = db
    .prepare("SELECT host_key, name, last_access_utc FROM cookies ORDER BY host_key, name")
    .all();
  db.close();
  return out;
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// --- Case 1+2: fresh profile (no cookie DB), run carries cookies.
makeCookieDb(join(runDir, COOKIE), [
  [".douyin.com", "", "sessionid", "/", 100, 999, 500, Buffer.from("v10aa")],
  [".douyin.com", "", "ttwid", "/", 100, 999, 400, Buffer.from("v10bb")],
]);
mkdirSync(join(profileDir, "Default", "Network"), { recursive: true }); // empty profile side

{
  const calls = [];
  const res = await syncRunIntoProfile({
    runDir, profileDir,
    runDataDir: runDir, profileDataDir: profileDir,
    baseline: undefined, syncBack: true,
    isLastRun: () => { calls.push(Date.now()); return true; },
  });
  check("case1 ok:true", res.ok === true);
  check("case1 isLastRun called exactly once", calls.length === 1);
  const got = rows(join(profileDir, COOKIE));
  check("case1 cookies bootstrapped into profile (2 rows)", got.length === 2 && got[0].name === "sessionid");
}

// --- Case 3: isLastRun() false → copy-back skipped.
{
  rmSync(join(profileDir, "marker.txt"), { force: true });
  writeFileSync(join(runDir, "marker.txt"), "identity");
  const res = await syncRunIntoProfile({
    runDir, profileDir,
    runDataDir: runDir, profileDataDir: profileDir,
    baseline: undefined, syncBack: true,
    isLastRun: () => false,
  });
  check("case3 ok:true (cookie merge itself succeeded)", res.ok === true);
  check("case3 copy-back skipped (marker absent)", !existsSync(join(profileDir, "marker.txt")));
}

// --- Case 4: isLastRun() true → copy-back runs.
{
  const res = await syncRunIntoProfile({
    runDir, profileDir,
    runDataDir: runDir, profileDataDir: profileDir,
    baseline: undefined, syncBack: true,
    isLastRun: () => true,
  });
  check("case4 ok:true", res.ok === true);
  check("case4 marker copied back", existsSync(join(profileDir, "marker.txt")) &&
    readFileSync(join(profileDir, "marker.txt"), "utf8") === "identity");
}

// --- Case 5: run cookie DB locked by another handle → merge throws → {ok:false}
// (a corrupt file is NOT a failure — it resolves to the deliberate
// "skipped-schema" no-op; the exhausting-retries path needs a live lock).
{
  const bad = join(root, "badrun");
  makeCookieDb(join(bad, COOKIE), [
    [".douyin.com", "", "locked", "/", 100, 999, 500, Buffer.from("v10aa")],
  ]);
  writeFileSync(join(bad, "leveldb.txt"), "x");
  const locker = new Database(join(bad, COOKIE)); // hold an EXCLUSIVE lock
  locker.exec("BEGIN EXCLUSIVE");
  const res = await syncRunIntoProfile({
    runDir: bad, profileDir,
    runDataDir: bad, profileDataDir: profileDir,
    baseline: undefined, syncBack: true,
    isLastRun: () => true,
  });
  locker.exec("ROLLBACK");
  locker.close();
  check("case5 ok:false on locked run DB (retries exhausted)", res.ok === false);
  // Copy-back is independent of the cookie lock (it never touches Cookies)
  // and still lands the non-cookie identity files; ok:false keeps the run
  // dir alive so orphan recovery retries the cookie merge.
  check("case5 copy-back still ran (leveldb.txt present)", existsSync(join(profileDir, "leveldb.txt")));
}

// --- Case 6: ephemeral (syncBack:false) short-circuits, ok:true, dir untouched.
{
  writeFileSync(join(runDir, "eph.txt"), "x");
  const res = await syncRunIntoProfile({
    runDir, profileDir,
    runDataDir: runDir, profileDataDir: profileDir,
    baseline: undefined, syncBack: false,
    isLastRun: () => true,
  });
  check("case6 ok:true", res.ok === true);
  check("case6 nothing synced (eph.txt absent in profile)", !existsSync(join(profileDir, "eph.txt")));
}

rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
