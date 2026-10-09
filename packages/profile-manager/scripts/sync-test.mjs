// Scratch integration test for src/sync.ts — run: node .tmp-sync-test.mjs
// Exercises: baseline capture, guarded upsert, logout deletion, sibling guards,
// bootstrap-copy, schema guard, wholesale copy-back skip list.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { captureCookieBaseline, syncRunIntoProfile } from "../dist/sync.js";

const SCHEMA = `
CREATE TABLE cookies (
  creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL,
  name TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', encrypted_value BLOB NOT NULL DEFAULT x'',
  path TEXT NOT NULL, expires_utc INTEGER NOT NULL DEFAULT 0, is_secure INTEGER NOT NULL DEFAULT 0,
  is_httponly INTEGER NOT NULL DEFAULT 0, last_access_utc INTEGER NOT NULL,
  has_expires INTEGER NOT NULL DEFAULT 1, is_persistent INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 1, samesite INTEGER NOT NULL DEFAULT -1,
  source_scheme INTEGER NOT NULL DEFAULT 2, source_port INTEGER NOT NULL DEFAULT 443,
  last_update_utc INTEGER NOT NULL DEFAULT 0, source_type INTEGER NOT NULL DEFAULT 1,
  has_cross_site_ancestor INTEGER NOT NULL DEFAULT 0,
  UNIQUE (host_key, top_frame_site_key, name, path)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO meta (key, value) VALUES ('version', '24'), ('mmap_status', '-1');
`;

function makeCookieDb(browserDataDir, rows, version = "24") {
  mkdirSync(join(browserDataDir, "Default", "Network"), { recursive: true });
  const db = new Database(join(browserDataDir, "Default", "Network", "Cookies"));
  db.exec(version === "24" ? SCHEMA : SCHEMA.replace("'24'", `'${version}'`));
  const ins = db.prepare(
    `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value,
       encrypted_value, path, expires_utc, is_secure, is_httponly, last_access_utc)
     VALUES (@creation, @host, '', @name, @value, x'0102', @path, 99999999999999999,
       1, 1, @access)`,
  );
  for (const r of rows)
    ins.run({
      creation: r.access - 10_000_000,
      host: r.host,
      name: r.name,
      value: r.value ?? "",
      path: r.path ?? "/",
      access: r.access,
    });
  db.close();
}

function readRows(browserDataDir) {
  const db = new Database(join(browserDataDir, "Default", "Network", "Cookies"), {
    readonly: true,
  });
  const rows = db
    .prepare(
      "SELECT host_key, name, path, value, last_access_utc AS access FROM cookies ORDER BY host_key, name",
    )
    .all();
  db.close();
  return rows;
}

let failed = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
}

const root = mkdtempSync(join(tmpdir(), "mz-sync-test-"));
try {
  // ── 1. baseline capture on missing db + guarded merge scenario ──────────
  const profile = join(root, "profile");
  const run = join(root, "run");
  const P = join(profile, "engines", "cb");
  const R = join(run, "engines", "cb");

  makeCookieDb(P, [
    { host: ".chatgpt.com", name: "sess", value: "v1", access: 100 },
    { host: ".other.com", name: "b", value: "vb", access: 100 },
    { host: ".doomed.com", name: "c", value: "vc", access: 100 },
    { host: ".contested.com", name: "d", value: "vd", access: 100 },
    { host: ".contested.com", name: "f", value: "vf-old", access: 100 },
  ]);
  const baseline = captureCookieBaseline(P);
  check("baseline size 5", baseline.size === 5);

  // The run: refreshed chatgpt sess, left .other.com alone, logged OUT of
  // .doomed.com, DELETED .contested.com/d (but sibling refreshed it meanwhile),
  // and carries a stale .contested.com/f.
  makeCookieDb(R, [
    { host: ".chatgpt.com", name: "sess", value: "v2", access: 500 },
    { host: ".other.com", name: "b", value: "vb", access: 100 },
    { host: ".contested.com", name: "f", value: "vf-stale", access: 50 },
  ]);

  // Sibling activity while the run was live: new row G, refreshed D and F.
  {
    const db = new Database(join(P, "Default", "Network", "Cookies"));
    db.prepare(
      `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, path,
         expires_utc, is_secure, is_httponly, last_access_utc)
       VALUES (1, '.sibling.com', '', 'g', 'vg', '/', 99999999999999999, 1, 1, 600)`,
    ).run();
    db.prepare("UPDATE cookies SET last_access_utc = 700 WHERE host_key = '.contested.com' AND name = 'd'").run();
    db.prepare("UPDATE cookies SET value = 'vf-new', last_access_utc = 600 WHERE host_key = '.contested.com' AND name = 'f'").run();
    db.close();
  }

  await syncRunIntoProfile({
    runDir: run,
    profileDir: profile,
    runDataDir: R,
    profileDataDir: P,
    baseline,
    syncBack: true,
    isLastRun: () => false, // cookies only — copy-back assertions come separately
  });

  const rows = readRows(P);
  const get = (host, name) => rows.find((r) => r.host_key === host && r.name === name);
  check("refreshed cookie wins (chatgpt v2 @500)", get(".chatgpt.com", "sess")?.value === "v2");
  check("untouched cookie intact", get(".other.com", "b")?.access === 100);
  check("logout propagates (doomed deleted)", get(".doomed.com", "c") === undefined);
  check("sibling-refreshed row NOT deleted (d @700)", get(".contested.com", "d")?.access === 700);
  check("stale run row does NOT clobber sibling (f keeps vf-new)", get(".contested.com", "f")?.value === "vf-new");
  check("sibling-new cookie intact (g)", get(".sibling.com", "g")?.value === "vg");
  check("row count 5", rows.length === 5);

  // ── 2. schema guard ─────────────────────────────────────────────────────
  const run2 = join(root, "run-schema-mismatch");
  makeCookieDb(join(run2, "engines", "cb"), [
    { host: ".x.com", name: "n", value: "x", access: 999 },
  ], "25");
  await syncRunIntoProfile({
    runDir: run2,
    profileDir: profile,
    runDataDir: join(run2, "engines", "cb"),
    profileDataDir: P,
    baseline: undefined,
    syncBack: true,
    isLastRun: () => false,
  });
  check("schema mismatch → no rows changed", readRows(P).length === 5);

  // ── 3. bootstrap-copy when profile has no cookie db yet ────────────────
  const profile3 = join(root, "profile-fresh");
  const run3 = join(root, "run-fresh");
  makeCookieDb(join(run3, "e"), [{ host: ".fresh.com", name: "a", value: "1", access: 5 }]);
  await syncRunIntoProfile({
    runDir: run3,
    profileDir: profile3,
    runDataDir: join(run3, "e"),
    profileDataDir: join(profile3, "e"),
    baseline: undefined,
    syncBack: true,
    isLastRun: () => false,
  });
  check(
    "bootstrap-copy materialized cookie db",
    readRows(join(profile3, "e")).some((r) => r.host_key === ".fresh.com"),
  );

  // ── 4. syncBack=false touches nothing ───────────────────────────────────
  const before = readFileSync(join(P, "Default", "Network", "Cookies")).length;
  await syncRunIntoProfile({
    runDir: run,
    profileDir: profile,
    runDataDir: R,
    profileDataDir: P,
    baseline,
    syncBack: false,
    isLastRun: () => true,
  });
  check("ephemeral: cookie db untouched", readFileSync(join(P, "Default", "Network", "Cookies")).length === before);

  // ── 5. wholesale copy-back on last-run exit ─────────────────────────────
  const run5 = join(root, "run-last");
  mkdirSync(join(run5, "Default", "Network"), { recursive: true });
  mkdirSync(join(run5, "Default", "Local Storage", "leveldb"), { recursive: true });
  mkdirSync(join(run5, "Default", "Cache", "Cache_Data"), { recursive: true });
  mkdirSync(join(run5, "Default", "Sessions"), { recursive: true });
  mkdirSync(join(run5, "GrShaderCache"), { recursive: true });
  writeFileSync(join(run5, "Local State"), '{"run":true}');
  writeFileSync(join(run5, "Default", "Preferences"), '{"run":true}');
  writeFileSync(join(run5, "Default", "Network", "Cookies"), "RUN-COPIED-BY-MISTAKE");
  writeFileSync(join(run5, "Default", "Local Storage", "leveldb", "000003.log"), "ls-data");
  writeFileSync(join(run5, "Default", "Cache", "Cache_Data", "f1"), "junk");
  writeFileSync(join(run5, "Default", "Sessions", "s1"), "tabs");
  writeFileSync(join(run5, "GrShaderCache", "f"), "junk");

  const cookieBytesBefore = readFileSync(join(P, "Default", "Network", "Cookies"));
  await syncRunIntoProfile({
    runDir: run5,
    profileDir: profile,
    runDataDir: join(run5, "engines", "cb"),
    profileDataDir: P,
    baseline: undefined,
    syncBack: true,
    isLastRun: () => true,
  });
  check("Local State copied back", readFileSync(join(profile, "Local State"), "utf8") === '{"run":true}');
  check("Preferences copied back", existsSync(join(profile, "Default", "Preferences")));
  check("Local Storage copied back", existsSync(join(profile, "Default", "Local Storage", "leveldb", "000003.log")));
  check("cookie db NOT file-clobbered", readFileSync(join(P, "Default", "Network", "Cookies")).equals(cookieBytesBefore));
  check("Cache never copied back", !existsSync(join(profile, "Default", "Cache")));
  check("Sessions never copied back", !existsSync(join(profile, "Default", "Sessions")));
  check("GrShaderCache never copied back", !existsSync(join(profile, "GrShaderCache")));

  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILURE(S)`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
