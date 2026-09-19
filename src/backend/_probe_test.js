#!/usr/bin/env node
"use strict";
const net = require("net");

function probeTcp(host, port, timeoutMs) {
  timeoutMs = timeoutMs || 1000;
  return new Promise(function(resolve) {
    const sock = new net.Socket();
    function done(ok) { sock.destroy(); resolve(ok); }
    sock.setTimeout(timeoutMs);
    sock.once("connect", function() { done(true); });
    sock.once("timeout", function() { done(false); });
    sock.once("error",   function() { done(false); });
    sock.connect(port, host);
  });
}

const start = Date.now();
probeTcp("127.0.0.1", 29999).then(function(r) {
  console.log("probe result:", r, "elapsed:", Date.now() - start, "ms");
  process.exit(0);
});
