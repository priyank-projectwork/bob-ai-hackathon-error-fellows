/**
 * sim/recorder.js — record a run, replay it anywhere.
 *
 * `npm run record` drives the real world and real engines and writes every
 * reading and event to an NDJSON file. `npm run demo` plays that file back
 * through the same pipeline, so the numbers on screen are engine output, not
 * a script someone typed.
 *
 * The recording is REGENERABLE: delete it, run record again with the same seed,
 * and you get the same file. Nothing here is hand-edited, and nothing in the
 * demo is faked — if an engine changes, the recording changes with it.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(__dirname, "..", "recordings");

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

class Recorder {
  constructor(name = "in-ke") {
    ensureDir();
    this.file = path.join(DIR, `${name}.ndjson`);
    this.stream = fs.createWriteStream(this.file, { flags: "w" });
    this.count = 0;
  }

  write(kind, payload) {
    this.stream.write(JSON.stringify({ kind, ...payload }) + "\n");
    this.count += 1;
  }

  async close(meta) {
    await new Promise((r) => this.stream.end(r));
    const body = fs.readFileSync(this.file);
    const manifest = {
      ...meta,
      file: path.basename(this.file),
      lines: this.count,
      sha256: crypto.createHash("sha256").update(body).digest("hex"),
      note:
        "Produced by `npm run record` from the real engines. Regenerate it " +
        "yourself with the same seed and you will get the same file.",
    };
    fs.writeFileSync(this.file.replace(/\.ndjson$/, ".manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }
}

/** Read a recording back, newest-format tolerant. */
function loadRecording(name = "in-ke") {
  const file = path.join(DIR, `${name}.ndjson`);
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

/** Verify a recording still matches its manifest hash. */
function verifyRecording(name = "in-ke") {
  const file = path.join(DIR, `${name}.ndjson`);
  const manifestPath = file.replace(/\.ndjson$/, ".manifest.json");
  if (!fs.existsSync(file) || !fs.existsSync(manifestPath)) {
    return { ok: false, reason: "recording or manifest missing" };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return {
    ok: actual === manifest.sha256,
    expected: manifest.sha256,
    actual,
    reason: actual === manifest.sha256 ? null : "recording has been edited since it was produced",
  };
}

/**
 * Replay a recording into a consumer at a chosen speed.
 * @param {Array} entries
 * @param {Function} onEntry async (entry) => void
 * @param {object} opts { speed, onDone }
 */
async function replay(entries, onEntry, { speed = 600, signal } = {}) {
  if (!entries.length) return;
  const t0 = entries[0].at ?? 0;
  const startedReal = Date.now();

  for (const entry of entries) {
    if (signal?.aborted) return;
    const simElapsed = (entry.at ?? t0) - t0;
    const realTarget = startedReal + simElapsed / speed;
    const wait = realTarget - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 2000)));
    await onEntry(entry);
  }
}

module.exports = { Recorder, loadRecording, verifyRecording, replay, DIR };
