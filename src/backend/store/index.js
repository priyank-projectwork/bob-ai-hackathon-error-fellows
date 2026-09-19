// store/index.js
"use strict";
const net = require("net");
const mongoose = require("mongoose");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bob-logistics-hackathon";

// Exported so server.js can surface it in /health
let storeMode = "none";
function getStoreMode() {
  return storeMode;
}

// Logged at most once so log lines don't repeat on every request.
let _noneWarned = false;
function warnNoDatabase() {
  if (!_noneWarned) {
    _noneWarned = true;
    console.warn(
      "⚠️  No database — API runs in replay/demo mode only " +
        "(start MongoDB, or set ENABLE_MEMORY_DB=1 to download an in-memory server)"
    );
  }
}

// Cheap TCP preflight — resolves true/false within timeoutMs.
// Never throws.
function probeTcp(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error",   () => done(false));
    sock.connect(port, host);
  });
}

async function connectStore() {
  // --- Primary: real MongoDB ---
  // For mongodb+srv:// URIs, skip the TCP probe (SRV records resolve to many
  // endpoints; we can't check them cheaply). For standard URIs, probe the
  // single host:port first so we never hand a dead endpoint to mongoose and
  // trigger its unbounded internal retry loop.
  let mongoReachable = true; // assume reachable for SRV

  let parsedUrl;
  try {
    parsedUrl = new URL(MONGO_URI);
  } catch (e) {
    parsedUrl = null;
  }

  if (parsedUrl && parsedUrl.protocol !== "mongodb+srv:") {
    const host = parsedUrl.hostname || "127.0.0.1";
    const port = parseInt(parsedUrl.port, 10) || 27017;
    mongoReachable = await probeTcp(host, port);
  }

  if (mongoReachable) {
    try {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
      });
      console.log("✅ MongoDB connected");
      storeMode = "mongo";
      return { mode: "mongo" };
    } catch (err) {
      // Probe succeeded but mongoose still failed (auth error, wrong db, etc.)
      // Fall through to memory/none path.
    }
  }

  console.warn(
    "⚠️  MongoDB unavailable — starting in memory mode (data will not persist)"
  );

  // --- Fallback: mongodb-memory-server (opt-in, raced against hard timeout) ---
  const { startMemoryServer } = require("./memoryStore");

  let memUri = null;
  try {
    memUri = await Promise.race([
      startMemoryServer(),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } catch (e) {
    // startMemoryServer should never throw, but guard anyway
    memUri = null;
  }

  if (memUri) {
    try {
      await mongoose.connect(memUri, { serverSelectionTimeoutMS: 3000 });
      console.log("✅ In-memory MongoDB connected");
      storeMode = "memory";
      return { mode: "memory" };
    } catch (memErr) {
      console.warn("⚠️  In-memory MongoDB connect failed:", memErr.message);
    }
  }

  warnNoDatabase();
  storeMode = "none";
  return { mode: "none" };
}

module.exports = { connectStore, getStoreMode, warnNoDatabase };
