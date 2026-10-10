// Build profile-manager, then run with Electron's Node runtime (native SQLite).
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import Database from "better-sqlite3";
import { ProfileManager, copyProfileData } from "../dist/ProfileManager.js";
import { captureCookieBaseline, syncRunIntoProfile } from "../dist/sync.js";

const root = mkdtempSync(join(tmpdir(), "mz-duplicate-test-"));
const pm = new ProfileManager({
  dbPath: join(root, "profiles.db"),
  profilesRoot: join(root, "profiles"),
});
function cookiePath(dir) {
  return join(dir, "Default", "Network", "Cookies");
}
function setSession(dir, value) {
  mkdirSync(dirname(cookiePath(dir)), { recursive: true });
  const db = new Database(cookiePath(dir));
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS cookies (
      host_key TEXT, top_frame_site_key TEXT, name TEXT, path TEXT, value TEXT,
      last_access_utc INTEGER, UNIQUE(host_key, top_frame_site_key, name, path));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO meta VALUES ('version', '24');`);
    db.prepare(
      "INSERT OR REPLACE INTO cookies VALUES ('example.test', '', 'session', '/', ?, ?)",
    ).run(value, Date.now());
  } finally {
    db.close();
  }
}
function session(dir) {
  const db = new Database(cookiePath(dir), { readonly: true });
  try {
    return db.prepare("SELECT value FROM cookies WHERE name = 'session'").get()?.value;
  } finally {
    db.close();
  }
}

try {
  const source = pm.create({
    name: "Account A",
    notes: "keep settings",
    tags: ["test"],
    icon: "A",
    startUrl: "https://example.test",
    proxy: { type: "http", host: "localhost", port: 8080 },
    extensions: [
      {
        id: "local",
        name: "Local",
        version: "1",
        scope: "profile",
        enabled: true,
        dir: "extensions/local",
        source: "folder",
      },
    ],
  });
  for (const engine of ["", "engines/cloakbrowser"])
    setSession(join(source.dataDir, engine), "account-a");
  const stateFiles = [
    "Local State",
    "Default/Preferences",
    "Default/Local Storage/leveldb/000001.ldb",
    "Default/IndexedDB/site.leveldb/000001.ldb",
    "Default/Session Storage/000001.ldb",
    "Default/Local Extension Settings/local/000001.ldb",
    "extensions/local/manifest.json",
    "engines/cloakbrowser/Local State",
    "engines/cloakbrowser/Default/Local Storage/leveldb/000001.ldb",
  ];
  for (const rel of stateFiles) {
    const file = join(source.dataDir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `original:${rel}`);
  }
  const copy = await pm.duplicate(source.id);
  assert.notEqual(copy.id, source.id);
  assert.notEqual(copy.dataDir, source.dataDir);
  for (const key of ["notes", "tags", "icon", "startUrl", "proxy", "fingerprint", "extensions"]) {
    assert.deepEqual(pm.get(copy.id)[key], source[key], key);
  }
  for (const rel of stateFiles) {
    assert.ok(
      readFileSync(join(copy.dataDir, rel)).equals(readFileSync(join(source.dataDir, rel))),
      rel,
    );
  }
  for (const engine of ["", "engines/cloakbrowser"]) {
    assert.equal(
      session(join(copy.dataDir, engine)),
      "account-a",
      "all engine login state carries over",
    );
  }
  console.log(
    "PASS one-click full copy preserves login state, website storage, extensions and settings",
  );

  for (const engine of ["", "engines/cloakbrowser"]) {
    const runDir = join(root, engine ? "cloak-run" : "cft-run");
    await copyProfileData(copy.dataDir, runDir);
    const runDataDir = join(runDir, engine);
    const baseline = captureCookieBaseline(runDataDir);
    const originalCookies = readFileSync(cookiePath(join(source.dataDir, engine)));
    setSession(runDataDir, "account-b");
    writeFileSync(
      join(runDir, engine, "Default/Local Storage/leveldb/000001.ldb"),
      "new-local-state",
    );
    assert.deepEqual(
      await syncRunIntoProfile({
        runDir,
        profileDir: copy.dataDir,
        runDataDir,
        profileDataDir: join(copy.dataDir, engine),
        baseline,
        syncBack: true,
        isLastRun: () => true,
      }),
      { ok: true },
    );
    assert.equal(session(join(copy.dataDir, engine)), "account-b");
    assert.equal(session(join(source.dataDir, engine)), "account-a");
    assert.ok(readFileSync(cookiePath(join(source.dataDir, engine))).equals(originalCookies));
    const rel = join(engine, "Default/Local Storage/leveldb/000001.ldb");
    assert.equal(readFileSync(join(copy.dataDir, rel), "utf8"), "new-local-state");
    assert.equal(
      readFileSync(join(source.dataDir, rel), "utf8"),
      `original:${rel.replaceAll("\\", "/")}`,
    );
  }
  const reopened = join(root, "reopened");
  await copyProfileData(copy.dataDir, reopened);
  assert.equal(session(reopened), "account-b");
  assert.equal(session(join(reopened, "engines/cloakbrowser")), "account-b");
  console.log(
    "PASS copy modifications and exit sync never write to source; new login persists on reopen",
  );

  const missing = pm.create({ name: "Missing source data" });
  rmSync(missing.dataDir, { recursive: true, force: true });
  const count = pm.list().length;
  const dirs = readdirSync(join(root, "profiles"));
  await assert.rejects(
    () => pm.duplicate(missing.id),
    /ENOENT/,
    "missing source data must fail instead of creating a logged-out partial copy",
  );
  assert.equal(pm.list().length, count);
  assert.deepEqual(
    readdirSync(join(root, "profiles")),
    dirs,
    "failed copy leaves no orphan data dir",
  );
  console.log(
    "PASS incomplete copies fail without adding a profile or leaving an orphan directory",
  );
} finally {
  pm.close();
  rmSync(root, { recursive: true, force: true });
}
