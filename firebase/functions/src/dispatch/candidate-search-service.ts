import {Firestore} from "firebase-admin/firestore";
import {CourierCandidate, DispatchConfig, DispatchHistoryEntry, GeoPoint} from "./contracts";
import {distanceMeters, searchCells, toH3Cell} from "./h3-service";
import {hardConstraintFailure} from "./hard-constraints";
import {calculateScore, sortCandidates} from "./scoring-service";
import {applyGoogleRoadMetrics} from "./routes-api-service";

export type CandidateSearchResult = {candidates: CourierCandidate[]; history: DispatchHistoryEntry[]};

export async function findCandidates(
  db: Firestore,
  order: any,
  config: DispatchConfig,
  now = Date.now()
): Promise<CandidateSearchResult> {
  const pickup: GeoPoint = order.pickup;
  const pickupH3Cell = toH3Cell(pickup, config.h3Resolution);
  const attemptedCourierIds = new Set<string>(order.attemptedCourierIds || []);
  // Query the persisted H3 index first. New and legacy couriers without an
  // indexed cell fall back to the broader read, so enabling dispatch is safe
  // before every device has sent its first post-upgrade GPS point.
  const widestCells = searchCells(pickup, config.h3Resolution, config.maxSearchRing);
  const chunks = Array.from({length: Math.ceil(widestCells.length / 10)}, (_, index) => widestCells.slice(index * 10, index * 10 + 10));
  const indexed = await Promise.all(chunks.map(cells => db.collection("users")
    .where("dispatchH3Cell", "in", cells).get()));
  const indexedDocs = indexed.flatMap(snapshot => snapshot.docs);
  const docs = indexedDocs.length >= config.minimumCandidates ? indexedDocs :
    (await db.collection("users").where("role", "==", "COURIER").get()).docs;
  const activeCounts = await Promise.all(docs.map(async document => ({
    id: document.id,
    count: (await db.collection("deliveries").where("courierId", "==", document.id)
      .where("status", "==", "IN_PROGRESS").get()).size,
  })));
  const activeById = new Map(activeCounts.map(value => [value.id, value.count]));
  const history: DispatchHistoryEntry[] = [];
  const normalized: any[] = docs.map(document => ({id: document.id, ...document.data()}));
  const passed = normalized.filter(courier => {
    const reason = hardConstraintFailure(courier, {...order, pickupH3Cell}, attemptedCourierIds,
      activeById.get(courier.id) || 0, now, config);
    if (reason) history.push({courierId: courier.id, courierName: courier.name || "", score: 0,
      distanceMeters: 0, etaSeconds: 0, etaSource: "GEODESIC_FALLBACK", activeOrders: activeById.get(courier.id) || 0,
      idleTimeSeconds: 0, h3Cell: courier.dispatchH3Cell || "", event: "EXCLUDED", reason, at: now});
    return !reason;
  });
  let h3Matches: any[] = [];
  for (let ring = config.initialSearchRing; ring <= config.maxSearchRing; ring += 1) {
    const cells = new Set(searchCells(pickup, config.h3Resolution, ring));
    h3Matches = passed.filter(courier => toH3Cell(courier.lastLocation, config.h3Resolution) &&
      cells.has(toH3Cell(courier.lastLocation, config.h3Resolution)));
    if (h3Matches.length >= config.minimumCandidates || ring === config.maxSearchRing) break;
  }
  const geographicCandidates = h3Matches.map(courier => {
    const location = courier.lastLocation as GeoPoint;
    const distance = distanceMeters(location, pickup);
    const etaSeconds = Math.round((distance / 1000) / config.averageSpeedKph * 3600);
    const idleSince = Number(courier.lastAssignedAt || courier.lastCompletedAt || courier.createdAt || now);
    const partial = {id: courier.id, name: courier.name || "", phone: courier.phone || "", location,
      h3Cell: toH3Cell(location, config.h3Resolution), distanceMeters: distance, etaSeconds,
      etaSource: "GEODESIC_FALLBACK" as const, activeOrders: activeById.get(courier.id) || 0,
      idleTimeSeconds: Math.max(0, now - idleSince) / 1000};
    return {...partial, score: calculateScore(partial, config)};
  }).filter(candidate => candidate.distanceMeters <= config.maxDistanceMeters);
  const candidates = sortCandidates(await applyGoogleRoadMetrics(
    sortCandidates(geographicCandidates), pickup, config
  ));
  for (const candidate of candidates) history.push({courierId: candidate.id, courierName: candidate.name,
    score: candidate.score, distanceMeters: candidate.distanceMeters, etaSeconds: candidate.etaSeconds,
    etaSource: candidate.etaSource, activeOrders: candidate.activeOrders, idleTimeSeconds: candidate.idleTimeSeconds,
    h3Cell: candidate.h3Cell, event: "CONSIDERED", at: now});
  return {candidates, history};
}
