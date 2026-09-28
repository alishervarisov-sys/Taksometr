import {Firestore} from "firebase-admin/firestore";
import {DEFAULT_DISPATCH_CONFIG, DispatchConfig} from "./contracts";

const CONFIG_COLLECTION = "settings";
const CONFIG_DOCUMENT = "smartDispatch";

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= min && numberValue <= max ? numberValue : fallback;
}

/** Keeps malformed admin configuration from changing dispatch behaviour. */
export async function loadDispatchConfig(db: Firestore): Promise<DispatchConfig> {
  const snapshot = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).get();
  const value = snapshot.exists ? snapshot.data() || {} : {};
  return {
    enabled: value.enabled === true,
    offerTimeoutSeconds: coerceNumber(value.offerTimeoutSeconds, DEFAULT_DISPATCH_CONFIG.offerTimeoutSeconds, 5, 300),
    maxAssignmentAttempts: coerceNumber(value.maxAssignmentAttempts, DEFAULT_DISPATCH_CONFIG.maxAssignmentAttempts, 1, 20),
    fallbackToOpenPool: value.fallbackToOpenPool !== false,
    h3Resolution: coerceNumber(value.h3Resolution, DEFAULT_DISPATCH_CONFIG.h3Resolution, 0, 15),
    initialSearchRing: coerceNumber(value.initialSearchRing, DEFAULT_DISPATCH_CONFIG.initialSearchRing, 0, 10),
    maxSearchRing: coerceNumber(value.maxSearchRing, DEFAULT_DISPATCH_CONFIG.maxSearchRing, 0, 20),
    minimumCandidates: coerceNumber(value.minimumCandidates, DEFAULT_DISPATCH_CONFIG.minimumCandidates, 1, 100),
    maxGpsAgeSeconds: coerceNumber(value.maxGpsAgeSeconds, DEFAULT_DISPATCH_CONFIG.maxGpsAgeSeconds, 10, 3600),
    maxDistanceMeters: coerceNumber(value.maxDistanceMeters, DEFAULT_DISPATCH_CONFIG.maxDistanceMeters, 100, 100_000),
    maxActiveOrdersPerCourier: coerceNumber(value.maxActiveOrdersPerCourier, DEFAULT_DISPATCH_CONFIG.maxActiveOrdersPerCourier, 1, 20),
    averageSpeedKph: coerceNumber(value.averageSpeedKph, DEFAULT_DISPATCH_CONFIG.averageSpeedKph, 5, 100),
    etaWeight: coerceNumber(value.etaWeight, DEFAULT_DISPATCH_CONFIG.etaWeight, 0, 1000),
    distanceWeight: coerceNumber(value.distanceWeight, DEFAULT_DISPATCH_CONFIG.distanceWeight, 0, 1000),
    courierLoadWeight: coerceNumber(value.courierLoadWeight, DEFAULT_DISPATCH_CONFIG.courierLoadWeight, 0, 1000),
    idleTimeWeight: coerceNumber(value.idleTimeWeight, DEFAULT_DISPATCH_CONFIG.idleTimeWeight, 0, 1000),
    batchAssignmentEnabled: value.batchAssignmentEnabled !== false,
  };
}

export async function saveDispatchConfig(
  db: Firestore,
  input: Partial<DispatchConfig>,
  updatedBy: string
): Promise<DispatchConfig> {
  const next = {...DEFAULT_DISPATCH_CONFIG, ...input};
  await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).set({
    ...next,
    updatedAt: Date.now(),
    updatedBy,
  }, {merge: true});
  return loadDispatchConfig(db);
}
