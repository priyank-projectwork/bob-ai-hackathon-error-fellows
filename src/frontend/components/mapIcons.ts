import L from "leaflet";
import type { ClockState } from "@/lib/api";

/**
 * Map pins.
 *
 * Keeps the original icon set — truck, vessel, plane — and the sonar ring,
 * which was the best thing about the first map. Two things are different:
 *
 *  1. Colour comes from the LIFE CLOCK, not a generic risk score, so a pin
 *     answers "how long has this cargo got".
 *  2. The vehicle glyph stays UPRIGHT and a separate chevron shows the
 *     heading. Rotating the glyph itself meant anything travelling west was
 *     drawn upside down, which read as broken rather than as westbound.
 */

export const TRUCK_SVG =
  `<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`;
export const VESSEL_SVG =
  `<path d="M2 20a2 2 0 002 2h16a2 2 0 002-2"/><path d="M5 20V10h14v10"/><path d="M8 10V6l4-4 4 4v4"/><line x1="12" y1="6" x2="12" y2="10"/>`;
export const PLANE_SVG =
  `<path d="M17.8 19.2L16 11l3.5-3.5C21 6 21 4 19.5 2.5S18 2 16.5 3.5L13 7 4.8 5.2A1 1 0 004 6l3 4.5-4 4V16l4-1 4 3h2l1-5.2z"/>`;

const MODE_SVG: Record<string, string> = {
  Road: TRUCK_SVG,
  Sea: VESSEL_SVG,
  Air: PLANE_SVG,
  Rail: TRUCK_SVG,
};

/** The life clock drives colour and whether the pin pulses, and how fast. */
/**
 * Colours come from the theme tokens, so pins follow light mode. Sonar is
 * reserved for red and black: a dozen amber rings shimmering at once is noise,
 * and on a compressed video constantly-moving high-contrast rings eat the
 * bitrate that should be spent on the numbers.
 */
const STATE_STYLE: Record<ClockState, { colour: string; ring: boolean; period: string }> = {
  green: { colour: "var(--ok)", ring: false, period: "0s" },
  amber: { colour: "var(--warn)", ring: false, period: "0s" },
  red: { colour: "var(--danger)", ring: true, period: "1.4s" },
  black: { colour: "var(--dead)", ring: true, period: "0.9s" },
};

export interface PinOptions {
  mode?: string;
  state?: ClockState;
  bearing?: number;
  selected?: boolean;
  halted?: boolean;
  label?: string;
}

/**
 * Icons are CACHED by their visual signature.
 *
 * Building a new L.DivIcon on every render made react-leaflet call
 * marker.setIcon() on every 2-second poll, which destroys and rebuilds the
 * icon's DOM element. That killed hover state mid-hover, restarted the sonar
 * animation, and made tooltips flicker — the "pin hovers are bad" symptom.
 *
 * The bearing is bucketed to 15 degrees so a ship nudging its course does not
 * invalidate the cache; the chevron is smoothly rotated by CSS within a bucket.
 */
const iconCache = new Map<string, L.DivIcon>();

export function shipmentPin(opts: PinOptions): L.DivIcon {
  // Bearing and label are deliberately NOT part of the identity. Including
  // them meant selecting a pin, or a ship nudging its course, changed the key
  // -> marker.setIcon() -> Leaflet replaces innerHTML -> the .lc-pin element
  // you are hovering is destroyed mid-hover and the sonar restarts. The
  // chevron is rotated by a CSS variable set per marker instead.
  const key = [
    opts.mode ?? "Road",
    opts.state ?? "green",
    opts.selected ? 1 : 0,
    opts.halted ? 1 : 0,
  ].join("|");

  const hit = iconCache.get(key);
  if (hit) return hit;

  const icon = buildShipmentPin(opts);
  iconCache.set(key, icon);
  // Bounded by construction: 4 modes x 4 states x selected x halted = 64.
  return icon;
}

function buildShipmentPin({
  mode = "Road",
  state = "green",
  selected = false,
  halted = false,
}: PinOptions): L.DivIcon {
  const { colour, ring, period } = STATE_STYLE[state];
  const glyph = MODE_SVG[mode] ?? TRUCK_SVG;
  const size = selected ? 40 : 32;
  const glyphSize = Math.round(size * 0.46);

  // The chevron sits on the rim of the halo, pointing along the course.
  // A chevron has no "up", so it is never upside down.
  const heading = halted
    ? ""
    : `<span class="lc-pin-heading" style="
         position:absolute;inset:0;
         pointer-events:none;">
         <svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
              style="position:absolute;inset:0;">
           <path d="M16 1.5 L19.2 7 H12.8 Z" fill="${colour}" opacity="0.95"/>
         </svg>
       </span>`;

  return L.divIcon({
    className: "",
    html: `
      <div class="lc-pin${selected ? " lc-pin-selected" : ""}" style="
        position:relative;width:${size}px;height:${size}px;
        display:flex;align-items:center;justify-content:center;">

        ${ring ? `<span class="lc-pin-sonar" style="
          position:absolute;inset:0;border-radius:50%;
          border:2px solid ${colour};
          animation:lcPinSonar ${period} cubic-bezier(0.2,0.8,0.3,1) infinite;
          pointer-events:none;"></span>` : ""}

        <span style="
          position:absolute;inset:3px;border-radius:50%;
          background:var(--surface,#111827);
          border:2px ${halted ? "dashed" : "solid"} ${colour};
          box-shadow:0 2px 6px rgba(0,0,0,0.35);"></span>

        ${heading}

        <svg width="${glyphSize}" height="${glyphSize}" viewBox="0 0 24 24"
             fill="none" stroke="${colour}" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round"
             style="position:relative;">
          ${glyph}
        </svg>

      </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    // Clears the halo and the chevron, and tracks the pin size automatically
    // instead of a hardcoded offset that collided with the selected pin.
    tooltipAnchor: [0, -(size / 2 + 8)],
  });
}

/** Idle fleet assets waiting for a job. Square, so they never read as cargo. */
export function assetPin(available = true): L.DivIcon {
  const colour = available ? "#22c55e" : "#64748b";
  return L.divIcon({
    className: "",
    html: `
      <div style="width:22px;height:22px;position:relative;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:0;border-radius:5px;
          background:var(--surface,#111827);border:1.5px solid ${colour};"></span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${colour}"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="position:relative;">
          ${TRUCK_SVG}
        </svg>
      </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
