#!/usr/bin/env bash
set -e

BACKEND=/mnt/d/MCA/IBM_hackathon/src/backend
TMPDIR=/tmp/server_timing_test2
rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"

echo "=== dotenvx timing alone ==="
START=$(date +%s%N)
DOTENVX_DEBUG=1 node -e "require('dotenv').config(); console.log('dotenv done')" \
  2>"$TMPDIR/dotenvx_debug.txt"
END=$(date +%s%N)
ELAPSED=$(echo "scale=2; ($END - $START) / 1000000000" | bc)
echo "dotenv.config() took ${ELAPSED}s"

# Check if dotenvx (not plain dotenv) is being used
echo ""
echo "=== which dotenv package is loaded ==="
node -e "
const m = require.resolve('dotenv');
console.log(m);
const pkg = require(m.replace('/lib/main.js','/package.json').replace('/dist/main.cjs','/package.json'));
console.log('version:', pkg.version);
" 2>&1 || true

# Try a minimal run bypassing dotenvx entirely
echo ""
echo "=== minimal boot (skip dotenv, dead mongo) ==="
START2=$(date +%s%N)
MONGO_URI=mongodb://127.0.0.1:29999/dead PORT=4086 WATSONX_API_KEY= \
  node -e "
process.env.MONGO_URI='mongodb://127.0.0.1:29999/dead';
const { connectStore } = require('$BACKEND/store/index.js');
connectStore().then(r => { console.log('connectStore result:', r.mode); process.exit(0); });
" >"$TMPDIR/cs_out.txt" 2>"$TMPDIR/cs_err.txt"
END2=$(date +%s%N)
ELAPSED2=$(echo "scale=2; ($END2 - $START2) / 1000000000" | bc)
echo "connectStore() alone took ${ELAPSED2}s"
cat "$TMPDIR/cs_out.txt"
cat "$TMPDIR/cs_err.txt"

rm -rf "$TMPDIR"
