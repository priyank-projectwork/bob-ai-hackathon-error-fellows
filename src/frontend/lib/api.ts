/**
 * One place that knows where the backend is.
 *
 * Every fetch used to carry a hardcoded http://127.0.0.1:4000 — twelve of them
 * across three files — so the app could only ever run on the machine that
 * built it. Set NEXT_PUBLIC_API_URL to point it anywhere.
 */
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message ?? body.error ?? detail;
    } catch {
      /* keep the status text */
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/health"),
  world: () => request<WorldSnapshot>("/api/v1/world"),
  lifeClocks: () => request<{ nowMs: number; count: number; clocks: LifeClock[] }>("/api/v1/lifeclock"),
  lifeClock: (id: string) => request<LifeClock>(`/api/v1/lifeclock/${id}`),
  excursions: (status = "Open") => request<{ excursions: Excursion[] }>(`/api/v1/excursions?status=${status}`),
  audit: (limit = 25) => request<{ events: AuditEvent[] }>(`/api/v1/audit?limit=${limit}`),
  verifyAudit: () => request<AuditVerdict>("/api/v1/audit/verify"),
  sim: {
    status: () => request<SimStatus>("/api/v1/sim/status"),
    play: () => request<SimStatus>("/api/v1/sim/play", { method: "POST" }),
    pause: () => request<SimStatus>("/api/v1/sim/pause", { method: "POST" }),
    speed: (speed: number) =>
      request<SimStatus>("/api/v1/sim/speed", { method: "POST", body: JSON.stringify({ speed }) }),
    skip: (hours: number) =>
      request<SimStatus>("/api/v1/sim/seek", { method: "POST", body: JSON.stringify({ hours }) }),
  },
  signDisposition: (id: string, decision: string, reason: string, asBob = false) =>
    request<{ ok: boolean; auditHash: string }>(`/api/v1/excursions/${id}/disposition`, {
      method: "POST",
      headers: asBob ? { "X-Actor": "bob" } : {},
      body: JSON.stringify({ decision, reason }),
    }),
};

// ── Shapes the UI relies on ────────────────────────────────────────────────

export type ClockState = "green" | "amber" | "red" | "black";

export interface Health {
  status: string;
  uptimeSec: number;
  store: "mongo" | "memory" | "none";
  ai: "watsonx" | "fallback";
  version: string;
}

export interface SimStatus {
  simNowMs: number;
  simNowIso: string;
  elapsedSimHours: number;
  speed: number;
  running: boolean;
  mode?: string;
}

export interface MovingShipment {
  shipmentId: string;
  cargoType?: string;
  priority?: string;
  transportMode?: string;
  position: [number, number] | null;
  bearing?: number;
  progressKm?: number;
  totalKm?: number;
  fractionDone?: number;
  etaMs?: number | null;
  arrived?: boolean;
  halted?: boolean;
  tempC?: number;
  unitMode?: string;
  remainingPath?: [number, number][];
  routeCoords?: [number, number][];
  moving?: boolean;
}

export interface WorldSnapshot {
  simNowMs: number;
  simNowIso: string;
  mode: string;
  shipments: MovingShipment[];
}

export interface LifeClock {
  shipmentId: string;
  profile: { key: string; version: number; name: string; rangeC: [number, number] };
  tempC: number | null;
  scheduleMarginH: number;
  stabilityMarginH: number;
  lifeClockH: number;
  bindingConstraint: "schedule" | "stability";
  state: ClockState;
  irreversible: boolean;
  severity: string;
  pLoss: number;
  usdAtRisk: number;
  dosesAtRisk: number;
  openExcursionId: string | null;
}

export interface Excursion {
  _id: string;
  shipmentId: string;
  severity: string;
  bandKey?: string;
  durationMin?: number;
  peakTempC?: number;
  minTempC?: number;
  mktC?: number | null;
  irreversible?: boolean;
  custodyCarrier?: string;
  ruleProfileRef?: { profileKey: string; version: number };
  rootCause?: { code: string; evidence: string[]; confidence: string };
  recommendedDisposition?: string;
  requiredRole?: string;
  rationale?: string[];
}

export interface AuditEvent {
  seq: number;
  at: number;
  /** Absent on rows written before the hash chain existed. */
  actor?: { sub: string; roles: string[] };
  /** Legacy column, still populated for backwards compatibility. */
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  outcome: "allowed" | "denied" | "recorded";
  hash?: string;
}

export interface AuditVerdict {
  valid: boolean;
  length: number;
  brokenAt: number | null;
  reason: string | null;
}
