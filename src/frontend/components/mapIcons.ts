import L from "leaflet";
import type { ClockState } from "@/lib/api";

/**
 * Map pins, built on the original LIFECLOCK icon set.
 *
 * Two changes from the earlier version:
 *
 *  1. Colour comes from the LIFE CLOCK, not a generic risk score. A pin's
 *     colour is the answer to "how long has this cargo got", which is the
 *     question the whole product is about.
 *  2. The vehicle rotates to its heading, so a fleet of ships reads as moving
 *     in a direction rather than as a scatter of dots.
 *
 * The sonar ring is kept — it was the best thing about the old map — but it is
 * now reserved for shipments that actually need attention, so it means
 * something instead of being ambient decoration.
 */

export const TRUCK_SVG =
  `<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`;
export const VESSEL_SVG =
  `<path d="M2 20a2 2 0 002 2h16a2 2 0 002-2"/><path d="M5 20V10h14v10"/><path d="M8 10V6l4-4 4 4v4"/><line x1="12" y1="6" x2="12" y2="10"/>`;
export const PLANE_SVG =
  `<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2A1 1 0 004 6l3 4.5-4 4V16l4-1 4 3h2l1-5.2z"/>`;
export const DEPOT_SVG =
  `<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><rect x="9" y="13" width="6" height="8"/>`;

/** Life-clock state drives colour, ring and how fast it pulses. */
const STATE_STYLE: Record<ClockState, { colour: string; ring: boolean; period: string }> = {
  green: { colour: "#22c55e", ring: false, period: "0s" },
  amber: { colour: "#f59e0b", ring: true, period: "2.6s" },
  red: { colour: "#ef4444", ring: true, period: "1.3s" },
  black: { colour: "#991b1b", ring: true, period: "0.8s" },
};

const MODE_SVG: Record<string, string> = {
  Road: TRUCK_SVG,
  Sea: VESSEL_SVG,
  Air: PLANE_SVG,
  Rail: TRUCK_SVG,
};

export interface PinOptions {
  mode?: string;
  state?: ClockState;
  bearing?: number;
  selected?: boolean;
  halted?: boolean;
  label?: string;
}

export function shipmentPin({
  mode = "Road",
  state = "green",
  bearing = 0,
  selected = false,
  halted = false,
  label,
}: PinOptions): L.DivIcon {
  const { colour, ring, period } = STATE_STYLE[state];
  const svg = MODE_SVG[mode] ?? TRUCK_SVG;
  const size = selected ? 42 : 34;
  // Vehicles point along their heading; a ship's icon reads bow-up, so the
  // glyph is rotated to the course while the halo stays upright.
  const rotation = mode === "Air" ? bearing : bearing - 90;

  return L.divIcon({
    className: "",
    html: `
      <div class="lc-pin ${selected ? "lc-pin-selected" : ""}" style="
        position:relative;width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;">

        ${ring ? `<span class="lc-pin-sonar" style="
          position:absolute;inset:0;border-radius:50%;
          border:2px solid ${colour};
          animation:lcPinSonar ${period} cubic-bezier(0.2,0.8,0.3,1) infinite;"></span>` : ""}

        <span style="
          position:absolute;inset:0;border-radius:50%;
          background:${colour}22;border:1.5px solid ${colour};
          ${halted ? "border-style:dashed;" : ""}
          box-shadow:0 0 0 ${selected ? 4 : 2}px ${colour}22, 0 2px 8px rgba(0,0,0,0.45);"></span>

        <svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24"
             fill="none" stroke="${colour}" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"
             style="position:relative;transform:rotate(${rotation}deg);transition:transform 1.2s linear;">
          ${svg}
        </svg>

        ${label ? `<span style="
          position:absolute;top:100%;margin-top:3px;white-space:nowrap;
          font:600 10px/1.2 system-ui,sans-serif;letter-spacing:0.02em;
          color:${colour};background:var(--surface,#111827);
          border:1px solid ${colour}55;border-radius:4px;padding:1px 5px;">${label}</span>` : ""}
      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Idle fleet assets waiting to be dispatched. */
export function assetPin(available = true): L.DivIcon {
  const colour = available ? "#22c55e" : "#64748b";
  return L.divIcon({
    className: "",
    html: `
      <div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;position:relative;">
        <span style="position:absolute;inset:0;border-radius:6px;background:${colour}1f;border:1px solid ${colour};"></span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${colour}"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:relative;">
          ${TRUCK_SVG}
        </svg>
      </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
