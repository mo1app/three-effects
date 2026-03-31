import {
  Color,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  ClampToEdgeWrapping,
} from "three/webgpu";

/**
 * A single color stop along a 1-D gradient, matching Photoshop’s gradient editor
 * notion of “location” along the ramp (0 = start, 1 = end).
 */
export interface ColorStop {
  /** Stop color (sRGB). */
  color: Color;
  /** Position in the range `[0, 1]`. Stops are sorted before interpolation. */
  position: number;
}

/**
 * Serializable gradient stop for UI / persistence (`#rrggbb` + position).
 * Convert to {@link ColorStop} with {@link colorStopsFromSerialized} for
 * {@link createGradientTexture}.
 */
export type SerializedGradientStop = {
  /** sRGB hex, e.g. `#ff0000` */
  color: string;
  /** Position in `[0, 1]`. */
  position: number;
};

/** Maps persisted stops to runtime {@link ColorStop} entries. */
export function colorStopsFromSerialized(stops: SerializedGradientStop[]): ColorStop[] {
  return stops.map((s) => ({
    color: new Color(s.color),
    position: s.position,
  }));
}

/**
 * Samples the gradient at `t` in `[0, 1]` and returns an `#rrggbb` string
 * (for CSS previews and new stop colors in the editor).
 */
export function sampleSerializedGradient(stops: SerializedGradientStop[], t: number): string {
  if (stops.length === 0) return "#000000";
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const c = sampleStops(colorStopsFromSerialized(sorted), t);
  return `#${c.getHexString()}`;
}

/**
 * Builds a horizontal 1×`width` RGBA {@link DataTexture} from sorted color stops.
 * Sample in shaders with `u` (or radial distance) in `[0, 1]` for linear/radial
 * gradient overlays and glow color ramps.
 *
 * @param stops - At least one stop. Multiple stops are linearly interpolated in
 *   sRGB space between adjacent positions.
 * @param width - Texel count along the gradient (default `256`). Larger values
 *   reduce banding when the texture is stretched.
 * @returns A `DataTexture` with `LinearFilter`, `ClampToEdgeWrapping`, and
 *   `SRGBColorSpace` so colors match typical Photoshop-like UI picks.
 */
export function createGradientTexture(
  stops: ColorStop[],
  width = 256,
): DataTexture {
  if (stops.length === 0) {
    throw new Error("createGradientTexture: at least one color stop is required");
  }

  const sorted = [...stops].sort((a, b) => a.position - b.position);

  const data = new Uint8Array(width * 4);

  for (let i = 0; i < width; i++) {
    const t = width === 1 ? 0 : i / (width - 1);
    const { r, g, b } = sampleStops(sorted, t);
    const o = i * 4;
    data[o] = Math.round(r * 255);
    data[o + 1] = Math.round(g * 255);
    data[o + 2] = Math.round(b * 255);
    data[o + 3] = 255;
  }

  const tex = new DataTexture(data, width, 1, RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;

  return tex;
}

/**
 * Linear interpolation between color stops at parameter `t` in `[0, 1]`.
 */
function sampleStops(stops: ColorStop[], t: number): Color {
  const clamped = Math.min(1, Math.max(0, t));

  if (stops.length === 1) {
    return stops[0].color.clone();
  }

  if (clamped <= stops[0].position) {
    return stops[0].color.clone();
  }
  if (clamped >= stops[stops.length - 1].position) {
    return stops[stops.length - 1].color.clone();
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.position && clamped <= b.position) {
      const span = b.position - a.position;
      const u = span < 1e-8 ? 0 : (clamped - a.position) / span;
      return new Color().lerpColors(a.color, b.color, u);
    }
  }

  return stops[stops.length - 1].color.clone();
}
