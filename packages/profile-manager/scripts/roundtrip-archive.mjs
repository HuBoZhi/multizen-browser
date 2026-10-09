/**
 * Round-trip test for the streaming exportProfile: the archive it writes
 * (encrypted chunk-by-chunk to disk) must still be readable by the untouched
 * importProfile, with checksums intact and files byte-identical — including
 * a large file that spans many read chunks (backpressure path) and an empty
 * file (zero-length framing).
 * Run: ELECTRON_RUN_AS_NODE=1 ../../apps/desktop/node_modules/.bin/electron scripts/roundtrip-archive.mjs
 */
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportProfile, importProfile } from "../dist/archive.js";

const root = join(tmpdir(), `mz-roundtrip-${Date.now()}`);
const dataDir = join(root, "profile");
mkdirSync(join(dataDir, "Default", "Network"), { recursive: true });

// Small file, empty file, and a 5 MB file (spans ~80 read chunks → exercises
// the per-chunk encrypt/backpressure loop).
writeFileSync(join(dataDir, "Local State"), '{"tz":"Asia/Shanghai"}');
writeFileSync(join(dataDir, "Default", "Network", "Cookies"), "");
const big = Buffer.alloc(5 * 1024 * 1024);
for (let i = 0; i < big.length; i += 4096) big.writeUInt32BE(i, i); // non-zero pattern
writeFileSync(join(dataDir, "big.bin"), big);

const profile = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "roundtrip",
  tags: ["t1"],
  fingerprint: { seed: "s" },
  dataDir,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
};

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const outPath = join(root, "arch.mzar");
await exportProfile(profile, "correct horse battery", outPath);

const restored = await importProfile(outPath, "correct horse battery", join(root, "profiles"));
check("profile metadata survives", restored.id === profile.id && restored.name === "roundtrip");
check("Local State byte-identical",
  readFileSync(join(restored.dataDir, "Local State"), "utf8") === '{"tz":"Asia/Shanghai"}');
check("empty file restored", existsSync(join(restored.dataDir, "Default", "Network", "Cookies")));
check("big file byte-identical", big.equals(readFileSync(join(restored.dataDir, "big.bin"))));

let wrongPassRejected = false;
try {
  await importProfile(outPath, "wrong passphrase", join(root, "profiles2"));
} catch (e) {
  wrongPassRejected = /wrong passphrase/i.test(String(e?.message));
}
check("wrong passphrase rejected", wrongPassRejected);

// Truncation → GCM failure, and the failed restore cleans up after itself.
const truncated = join(root, "trunc.mzar");
writeFileSync(truncated, readFileSync(outPath).subarray(0, 2000));
let truncRejected = false;
try {
  await importProfile(truncated, "correct horse battery", join(root, "profiles3"));
} catch {
  truncRejected = true;
}
check("truncated archive rejected", truncRejected);

rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
