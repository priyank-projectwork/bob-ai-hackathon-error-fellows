/**
 * graphRouter.js — real route search over the lane network.
 *
 * Replaces the string-matching cascade in routeOptimizer.js, which decided
 * routes by testing whether a location name contained "port" and returned
 * hardcoded cost and time literals. The graph it shipped with (DEMO_GRAPH) was
 * never called.
 *
 * Dijkstra for the best path, then Yen's algorithm for the next k-1, so the
 * alternatives are genuinely different routes rather than the same route
 * described three ways.
 *
 * PURE: takes edges in, gives paths out. No database, no network, no clock.
 */
"use strict";

/** Build an adjacency index from the flat edge list. */
function indexEdges(edges) {
  const byFrom = new Map();
  for (const e of edges) {
    if (!byFrom.has(e.from)) byFrom.set(e.from, []);
    byFrom.get(e.from).push(e);
    // Lanes are bidirectional for search purposes; keep the geometry reversed.
    if (!byFrom.has(e.to)) byFrom.set(e.to, []);
    byFrom.get(e.to).push({
      ...e,
      from: e.to,
      to: e.from,
      via: [...(e.via ?? [])].reverse(),
      coords: [...(e.coords ?? [])].reverse(),
      reversed: true,
    });
  }
  return byFrom;
}

/**
 * Cost of traversing an edge, in hours-equivalent, with disruption penalties.
 *
 * @param {object} edge
 * @param {object} opts
 * @param {Set}    opts.blockedNodes   nodes a disruption has closed
 * @param {Map}    opts.nodeDelayH     extra hours at a node
 * @param {string} opts.weight         "time" | "cost" | "co2"
 */
function edgeWeight(edge, { blockedNodes = new Set(), nodeDelayH = new Map(), weight = "time" } = {}) {
  const touches = [edge.from, ...(edge.via ?? []), edge.to];
  if (touches.some((n) => blockedNodes.has(n))) return Infinity;

  const delay = touches.reduce((sum, n) => sum + (nodeDelayH.get(n) ?? 0), 0);

  if (weight === "cost") return edge.costUsd;
  if (weight === "co2") return edge.co2Kg;
  return edge.hours + delay;
}

/** Dijkstra, returning the node path and the edges used. */
function shortestPath(edges, from, to, opts = {}) {
  const byFrom = opts._index ?? indexEdges(edges);
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = new Set([from]);

  while (queue.size) {
    let u = null;
    let best = Infinity;
    for (const n of queue) {
      const d = dist.get(n) ?? Infinity;
      if (d < best) { best = d; u = n; }
    }
    if (u === null) break;
    queue.delete(u);
    visited.add(u);
    if (u === to) break;

    for (const e of byFrom.get(u) ?? []) {
      if (visited.has(e.to)) continue;
      if (opts.bannedEdges?.has(edgeKey(e))) continue;
      if (opts.bannedNodes?.has(e.to)) continue;
      const w = edgeWeight(e, opts);
      if (!Number.isFinite(w)) continue;
      const alt = (dist.get(u) ?? Infinity) + w;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, { node: u, edge: e });
        queue.add(e.to);
      }
    }
  }

  if (!prev.has(to) && from !== to) return null;

  const path = [to];
  const used = [];
  let cur = to;
  while (cur !== from) {
    const step = prev.get(cur);
    if (!step) return null;
    used.unshift(step.edge);
    path.unshift(step.node);
    cur = step.node;
  }
  return { nodes: path, edges: used, weight: dist.get(to) };
}

function edgeKey(e) {
  return `${e.from}>${e.to}:${e.mode}:${e.laneId}`;
}

/** Summarise a path into the numbers an option needs. */
function summarise(pathEdges) {
  let hours = 0, costUsd = 0, co2Kg = 0, distanceKm = 0, riskBase = 0;
  const modes = new Set();
  const coords = [];
  for (const e of pathEdges) {
    hours += e.hours;
    costUsd += e.costUsd;
    co2Kg += e.co2Kg;
    distanceKm += e.distanceKm;
    riskBase = Math.max(riskBase, e.riskBase ?? 0);
    modes.add(e.mode);
    for (const p of e.coords ?? []) {
      const last = coords[coords.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
    }
  }
  return {
    hours: Number(hours.toFixed(2)),
    costUsd: Math.round(costUsd),
    co2Kg: Math.round(co2Kg),
    distanceKm: Math.round(distanceKm),
    riskBase,
    modes: [...modes],
    multiModal: modes.size > 1,
    coords,
  };
}

/**
 * Yen's k-shortest loopless paths.
 * @returns {Array<{nodes, edges, summary}>}
 */
function kShortestPaths(edges, from, to, k = 3, opts = {}) {
  const index = indexEdges(edges);
  const base = { ...opts, _index: index };

  const first = shortestPath(edges, from, to, base);
  if (!first) return [];

  const accepted = [first];
  const candidates = [];

  for (let i = 1; i < k; i++) {
    const prevPath = accepted[i - 1];

    for (let spur = 0; spur < prevPath.nodes.length - 1; spur++) {
      const spurNode = prevPath.nodes[spur];
      const rootNodes = prevPath.nodes.slice(0, spur + 1);
      const rootEdges = prevPath.edges.slice(0, spur);

      const bannedEdges = new Set();
      for (const p of accepted) {
        if (JSON.stringify(p.nodes.slice(0, spur + 1)) === JSON.stringify(rootNodes) && p.edges[spur]) {
          bannedEdges.add(edgeKey(p.edges[spur]));
        }
      }
      const bannedNodes = new Set(rootNodes.slice(0, -1));

      const spurPath = shortestPath(edges, spurNode, to, {
        ...base,
        bannedEdges,
        bannedNodes,
      });
      if (!spurPath) continue;

      const totalEdges = [...rootEdges, ...spurPath.edges];
      const totalNodes = [...rootNodes.slice(0, -1), ...spurPath.nodes];
      const key = totalNodes.join(">");
      if (accepted.some((p) => p.nodes.join(">") === key)) continue;
      if (candidates.some((p) => p.nodes.join(">") === key)) continue;

      candidates.push({ nodes: totalNodes, edges: totalEdges, weight: summarise(totalEdges).hours });
    }

    if (!candidates.length) break;
    candidates.sort((a, b) => a.weight - b.weight);
    accepted.push(candidates.shift());
  }

  return accepted.map((p) => ({ ...p, summary: summarise(p.edges) }));
}

module.exports = { shortestPath, kShortestPaths, indexEdges, edgeWeight, summarise, edgeKey };
