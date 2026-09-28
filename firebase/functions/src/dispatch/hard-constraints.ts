import {DispatchConfig, GeoPoint} from "./contracts";

export function validLocation(value: any): value is GeoPoint & {timestamp: number} {
  return !!value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    Number.isFinite(value.timestamp) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}

/** Returns a diagnostic reason instead of a boolean so history explains exclusions. */
export function hardConstraintFailure(
  courier: any,
  order: any,
  attemptedCourierIds: Set<string>,
  activeOrders: number,
  now: number,
  config: DispatchConfig
): string | null {
  if (courier.role !== "COURIER") return "NOT_A_COURIER";
  if (courier.isBlocked === true) return "BLOCKED";
  // isOnShift is the established availability flag. isOnline currently means
  // "has an IN_PROGRESS delivery" in this project, so using it would exclude idle couriers.
  if (courier.isOnShift === false || courier.isActive === false || courier.dispatchAvailable === false) return "OFFLINE";
  if (attemptedCourierIds.has(courier.id)) return "ALREADY_ATTEMPTED";
  if (!validLocation(courier.lastLocation)) return "MISSING_GPS";
  if (now - courier.lastLocation.timestamp > config.maxGpsAgeSeconds * 1000) return "STALE_GPS";
  if (activeOrders >= config.maxActiveOrdersPerCourier) return "MAX_ACTIVE_ORDERS";
  if (order.requiredVehicleType && courier.vehicleType !== order.requiredVehicleType) return "VEHICLE_MISMATCH";
  if (Array.isArray(courier.allowedH3Cells) && order.pickupH3Cell && !courier.allowedH3Cells.includes(order.pickupH3Cell)) return "OUTSIDE_ALLOWED_ZONE";
  if (order.status !== "PENDING" || order.orderKind !== "MARKETPLACE") return "ORDER_UNAVAILABLE";
  return null;
}
