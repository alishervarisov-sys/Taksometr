export type GeoPoint = {latitude: number; longitude: number};

export type DispatchConfig = {
  enabled: boolean;
  offerTimeoutSeconds: number;
  maxAssignmentAttempts: number;
  fallbackToOpenPool: boolean;
  h3Resolution: number;
  initialSearchRing: number;
  maxSearchRing: number;
  minimumCandidates: number;
  maxGpsAgeSeconds: number;
  maxDistanceMeters: number;
  maxActiveOrdersPerCourier: number;
  averageSpeedKph: number;
  etaWeight: number;
  distanceWeight: number;
  courierLoadWeight: number;
  idleTimeWeight: number;
  batchAssignmentEnabled: boolean;
};

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  // Compatibility first: existing installations continue to publish directly
  // into the shared courier pool until an administrator enables the feature.
  enabled: false,
  offerTimeoutSeconds: 20,
  maxAssignmentAttempts: 3,
  fallbackToOpenPool: true,
  h3Resolution: 8,
  initialSearchRing: 0,
  maxSearchRing: 3,
  minimumCandidates: 3,
  maxGpsAgeSeconds: 120,
  maxDistanceMeters: 15_000,
  maxActiveOrdersPerCourier: 2,
  averageSpeedKph: 22,
  etaWeight: 1,
  distanceWeight: 0.001,
  courierLoadWeight: 5,
  idleTimeWeight: 0.01,
  batchAssignmentEnabled: true,
};

export type CourierCandidate = {
  id: string;
  name: string;
  phone: string;
  location: GeoPoint;
  h3Cell: string;
  distanceMeters: number;
  etaSeconds: number;
  etaSource: "GEODESIC_FALLBACK" | "GOOGLE_ROUTES";
  activeOrders: number;
  idleTimeSeconds: number;
  score: number;
};

export type DispatchHistoryEntry = {
  courierId: string;
  courierName: string;
  score: number;
  distanceMeters: number;
  etaSeconds: number;
  etaSource: string;
  activeOrders: number;
  idleTimeSeconds: number;
  h3Cell: string;
  event: "CONSIDERED" | "OFFERED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "EXCLUDED";
  reason?: string;
  at: number;
};
