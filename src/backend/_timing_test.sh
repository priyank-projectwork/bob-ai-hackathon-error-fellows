#!/usr/bin/env bash
set -e

BACKEND=/mnt/d/MCA/IBM_hackathon/src/backend
TMPDIR=/tmp/server_timing_test
rm -rf "$TMPDIR" && mkdir -p "$TMPDIR"
echo "cwd contents (should be empty, no .env):"
ls -la "$TMPDIR"

# (a) timed boot with unreachable Mongo, no .env in cwd
MONGO_URI=mongodb://127.0.0.1:29999/dead PORT=4085 WATSONX_API_KEY= \
  node "$BACKEND/server.js" >"$TMPDIR/out.txt" 2>"$TMPDIR/err.txt" &
SERVER_PID=$!

START_NS=$(date +%s%N)
FOUND=0
for i in $(seq 1 150); do
  sleep 0.1
  grep -q "Server running" "$TMPDIR/out.txt" 2>/dev/null && { FOUND=1; break; }
done
END_NS=$(date +%s%N)
ELAPSED=$(echo "scale=2; ($END_NS - $START_NS) / 1000000000" | bc)

echo ""
echo "=== (a) timing ==="
if [ "$FOUND" -eq 1 ]; then
  echo "RESULT: 'Server running' appeared in ${ELAPSED}s"
else
  echo "RESULT: did not appear within 15s (elapsed ${ELAPSED}s)"
fi

echo ""
echo "=== stdout ==="
cat "$TMPDIR/out.txt"
echo ""
echo "=== stderr ==="
cat "$TMPDIR/err.txt"

# (b) /health
echo ""
echo "=== (b) /health ==="
curl -s -o "$TMPDIR/health.txt" -w "HTTP %{http_code}" http://localhost:4085/health
echo ""
cat "$TMPDIR/health.txt"
echo ""

# (c) DB-backed route -> 503
echo ""
echo "=== (c) /api/locations ==="
curl -s -o "$TMPDIR/loc.txt" -w "HTTP %{http_code}" http://localhost:4085/api/locations
echo ""
cat "$TMPDIR/loc.txt"
echo ""

# Server still alive after 503?
echo ""
echo "=== server still alive after 503 ==="
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:4085/health
echo ""

# Clean up
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null || true
sleep 1
kill -0 "$SERVER_PID" 2>/dev/null && echo "CLEANUP: still running" || echo "CLEANUP: exited cleanly"
rm -rf "$TMPDIR"
