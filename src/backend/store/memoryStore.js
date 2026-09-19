// store/memoryStore.js
// Spins up an in-memory MongoDB instance so Mongoose models keep working
// without a real MongoDB server.  Loaded lazily — only when the primary
// connect attempt fails AND ENABLE_MEMORY_DB=1 is explicitly set.
//
// Downloading the 122 MB MongoDB binary is OPT-IN.  Without the env flag,
// we return null immediately so the server never hangs on a network call.
"use strict";

async function startMemoryServer() {
  // Block any automatic binary download unless the operator opted in.
  if (process.env.ENABLE_MEMORY_DB !== "1") {
    process.env.MONGOMS_RUNTIME_DOWNLOAD = "0";
  }

  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = require("mongodb-memory-server"));
  } catch (e) {
    return null; // package not installed
  }

  // If downloads are disabled, check whether a cached binary already exists.
  // mongodb-memory-server exposes MongoBinary for this purpose.
  if (process.env.MONGOMS_RUNTIME_DOWNLOAD === "0") {
    try {
      const { MongoBinary } = require("mongodb-memory-server");
      // getPath() resolves to the binary path or throws if nothing is cached.
      await MongoBinary.getPath();
    } catch (e) {
      // No cached binary — return immediately rather than triggering a download.
      return null;
    }
  }

  try {
    const mongod = await MongoMemoryServer.create();
    return mongod.getUri();
  } catch (e) {
    return null;
  }
}

module.exports = { startMemoryServer };
