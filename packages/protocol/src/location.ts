/**
 * Simulator location control.
 *
 * `xcrun simctl location <device> set <lat>,<lon>` is the whole surface here.
 * The value is built through this module rather than string interpolation
 * because a coordinate that reaches simctl in exponent notation, with a comma
 * decimal separator, or outside the valid range fails in ways that look like a
 * device problem rather than a bad input.
 */

/** Decimal places kept when formatting. Six is ~11cm at the equator. */
const COORDINATE_PRECISION = 6;

export interface DeviceLocation {
  latitude: number;
  longitude: number;
}

export interface DeviceLocationParseResult {
  location?: DeviceLocation;
  /** Every problem found, so a caller can report them together. */
  errors: string[];
}

/**
 * A named place, so the common cases do not require looking up coordinates.
 * Chosen to cover the differences that actually break mobile apps: hemisphere,
 * date line, right-to-left and non-Latin locales, and the equator.
 */
export interface LocationPreset extends DeviceLocation {
  id: string;
  label: string;
  detail: string;
}

export const LOCATION_PRESETS: readonly LocationPreset[] = [
  { id: "san-francisco", label: "San Francisco", detail: "United States · Pacific", latitude: 37.774929, longitude: -122.419418 },
  { id: "new-york", label: "New York", detail: "United States · Eastern", latitude: 40.712776, longitude: -74.005974 },
  { id: "london", label: "London", detail: "United Kingdom · GMT", latitude: 51.507351, longitude: -0.127758 },
  { id: "berlin", label: "Berlin", detail: "Germany · comma decimal locale", latitude: 52.520008, longitude: 13.404954 },
  { id: "dubai", label: "Dubai", detail: "United Arab Emirates · right-to-left", latitude: 25.204849, longitude: 55.270782 },
  { id: "mumbai", label: "Mumbai", detail: "India · half-hour offset", latitude: 19.075983, longitude: 72.877655 },
  { id: "tokyo", label: "Tokyo", detail: "Japan · non-Latin script", latitude: 35.689487, longitude: 139.691711 },
  { id: "sydney", label: "Sydney", detail: "Australia · southern hemisphere", latitude: -33.868820, longitude: 151.209290 },
  { id: "sao-paulo", label: "São Paulo", detail: "Brazil · southern hemisphere", latitude: -23.550520, longitude: -46.633308 },
  { id: "quito", label: "Quito", detail: "Ecuador · on the equator", latitude: -0.180653, longitude: -78.467834 },
  { id: "auckland", label: "Auckland", detail: "New Zealand · near the date line", latitude: -36.848460, longitude: 174.763332 }
];

/**
 * Formats a coordinate for the simctl argument.
 *
 * `toFixed` is deliberate: it never emits exponent notation and always uses a
 * "." separator regardless of the host locale, both of which `toString` and
 * `toLocaleString` get wrong for the values that matter (1e-7, or any number
 * on a machine set to a comma-decimal locale).
 */
export function formatCoordinate(value: number): string {
  // `-0` would otherwise format as "-0.000000".
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toFixed(COORDINATE_PRECISION);
}

function parseCoordinate(value: unknown, axis: "latitude" | "longitude", limit: number): { value?: number; error?: string } {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return { error: `Give a ${axis} as a decimal number between ${-limit} and ${limit}.` };
  }
  if (numeric < -limit || numeric > limit) {
    return { error: `${axis === "latitude" ? "Latitude" : "Longitude"} must be between ${-limit} and ${limit}.` };
  }
  return { value: numeric };
}

/**
 * Validates a coordinate pair from any boundary — an HTTP body, a CLI flag, or
 * a form field. Reports every problem at once instead of failing on the first.
 */
export function parseDeviceLocation(latitude: unknown, longitude: unknown): DeviceLocationParseResult {
  const parsedLatitude = parseCoordinate(latitude, "latitude", 90);
  const parsedLongitude = parseCoordinate(longitude, "longitude", 180);
  const errors = [parsedLatitude.error, parsedLongitude.error].filter((error): error is string => Boolean(error));

  if (errors.length > 0) return { errors };
  return { location: { latitude: parsedLatitude.value!, longitude: parsedLongitude.value! }, errors: [] };
}

/** The `<lat>,<lon>` value simctl expects. */
export function formatDeviceLocation(location: DeviceLocation): string {
  return `${formatCoordinate(location.latitude)},${formatCoordinate(location.longitude)}`;
}

export function locationSetArgs(target: string, location: DeviceLocation): string[] {
  return ["simctl", "location", target, "set", formatDeviceLocation(location)];
}

export function locationClearArgs(target: string): string[] {
  return ["simctl", "location", target, "clear"];
}
