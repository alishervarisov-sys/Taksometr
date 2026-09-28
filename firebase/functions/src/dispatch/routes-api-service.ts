import {CourierCandidate, DispatchConfig, GeoPoint} from "./contracts";
import {calculateScore} from "./scoring-service";

const ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTING_CANDIDATE_LIMIT = 3;

type MatrixElement = {
  originIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
  status?: {code?: number};
};

function secondsFromGoogleDuration(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Math.round(Number(match[1])) : null;
}

/**
 * Refines only the strongest geographic candidates. This limits Matrix billing
 * to three courier-to-pickup elements per order and keeps the fallback local.
 */
export async function applyGoogleRoadMetrics(
  candidates: CourierCandidate[],
  pickup: GeoPoint,
  config: DispatchConfig
): Promise<CourierCandidate[]> {
  const apiKey = process.env.GOOGLE_ROUTES_API_KEY?.trim();
  if (!apiKey || candidates.length === 0) return candidates;
  const selected = candidates.slice(0, ROUTING_CANDIDATE_LIMIT);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(ROUTE_MATRIX_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition,status",
      },
      body: JSON.stringify({
        origins: selected.map(candidate => ({waypoint: {location: {latLng: candidate.location}}})),
        destinations: [{waypoint: {location: {latLng: pickup}}}],
        travelMode: "DRIVE",
      }),
    });
    if (!response.ok) {
      console.warn(`[DISPATCH] Google Routes unavailable (${response.status}); using geodesic ETA`);
      return candidates;
    }
    const elements = await response.json() as MatrixElement[];
    const metrics = new Map<number, {distanceMeters: number; etaSeconds: number}>();
    for (const element of elements) {
      const etaSeconds = secondsFromGoogleDuration(element.duration);
      if (element.condition === "ROUTE_EXISTS" && Number.isFinite(element.distanceMeters) && etaSeconds != null) {
        metrics.set(Number(element.originIndex), {distanceMeters: Number(element.distanceMeters), etaSeconds});
      }
    }
    return candidates.map((candidate, index) => {
      const metric = metrics.get(index);
      if (!metric) return candidate;
      const refined = {...candidate, ...metric, etaSource: "GOOGLE_ROUTES" as const};
      return {...refined, score: calculateScore(refined, config)};
    });
  } catch (error) {
    console.warn("[DISPATCH] Google Routes request failed; using geodesic ETA", error);
    return candidates;
  } finally {
    clearTimeout(timeout);
  }
}
