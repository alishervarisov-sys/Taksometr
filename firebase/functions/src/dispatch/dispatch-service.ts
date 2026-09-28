import {Firestore} from "firebase-admin/firestore";
import {CourierCandidate, DispatchConfig, DispatchHistoryEntry} from "./contracts";
import {findCandidates} from "./candidate-search-service";
import {loadDispatchConfig} from "./config-service";
import {hungarianAssignment} from "./hungarian-assignment-service";

type NotifyCourier = (courierId: string, courier: any, deliveryId: string) => Promise<void>;

async function appendHistory(db: Firestore, deliveryId: string, entries: DispatchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const batch = db.batch();
  for (const entry of entries) batch.set(db.collection("deliveries").doc(deliveryId)
    .collection("dispatchHistory").doc(), entry);
  await batch.commit();
}

async function openPoolCourierIds(db: Firestore): Promise<string[]> {
  const documents = await db.collection("users").where("role", "==", "COURIER")
    .where("isBlocked", "==", false).get();
  return documents.docs.filter(doc => doc.data()?.isOnShift !== false).map(doc => doc.id);
}

export async function moveToOpenPool(
  db: Firestore,
  deliveryId: string,
  reason: string,
  notify?: NotifyCourier
): Promise<void> {
  const availableCourierIds = await openPoolCourierIds(db);
  await db.collection("deliveries").doc(deliveryId).update({
    dispatchState: "OPEN_POOL",
    autoAssignmentFailedAt: Date.now(),
    autoAssignmentFailureReason: reason,
    offerCourierId: null,
    offerExpiresAt: null,
    availableCourierIds,
  });
  await appendHistory(db, deliveryId, [{courierId: "", courierName: "", score: 0, distanceMeters: 0,
    etaSeconds: 0, etaSource: "", activeOrders: 0, idleTimeSeconds: 0, h3Cell: "", event: "EXCLUDED",
    reason: `OPEN_POOL:${reason}`, at: Date.now()}]);
  if (notify) {
    await Promise.all(availableCourierIds.map(async courierId => {
      const courier = await db.collection("users").doc(courierId).get();
      if (courier.exists) await notify(courierId, courier.data()!, deliveryId);
    }));
  }
  console.log(`[DISPATCH] Order ${deliveryId} moved to OPEN_POOL: ${reason}`);
}

async function offerCandidate(
  db: Firestore,
  deliveryId: string,
  candidate: CourierCandidate,
  config: DispatchConfig,
  history: DispatchHistoryEntry[],
  notify: NotifyCourier
): Promise<boolean> {
  const ref = db.collection("deliveries").doc(deliveryId);
  const now = Date.now();
  const offered = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const order = snapshot.data()!;
    if (order.status !== "PENDING" || order.orderKind !== "MARKETPLACE" ||
        order.dispatchState === "OPEN_POOL" || order.dispatchState === "ACCEPTED") return false;
    const attempted = new Set<string>(order.attemptedCourierIds || []);
    if (attempted.has(candidate.id)) return false;
    const attemptCount = Number(order.assignmentAttemptCount || 0);
    if (attemptCount >= config.maxAssignmentAttempts) return false;
    transaction.update(ref, {
      dispatchState: "OFFERED",
      offerCourierId: candidate.id,
      offerExpiresAt: now + config.offerTimeoutSeconds * 1000,
      offerCreatedAt: now,
      availableCourierIds: [candidate.id],
      attemptedCourierIds: [...attempted, candidate.id],
      assignmentAttemptCount: attemptCount + 1,
      pickupH3Cell: order.pickupH3Cell || candidate.h3Cell,
    });
    transaction.set(db.collection("users").doc(candidate.id), {
      dispatchH3Cell: candidate.h3Cell,
      dispatchLocationUpdatedAt: now,
    }, {merge: true});
    return true;
  });
  if (!offered) return false;
  const considered = history.find(item => item.courierId === candidate.id);
  if (considered) await appendHistory(db, deliveryId, [...history, {...considered, event: "OFFERED", at: now}]);
  const courier = await db.collection("users").doc(candidate.id).get();
  if (courier.exists) await notify(candidate.id, courier.data()!, deliveryId);
  console.log(`[DISPATCH] Offer sent to courier ${candidate.id} for ${deliveryId}, score=${candidate.score.toFixed(2)}`);
  return true;
}

export async function dispatchOrder(db: Firestore, deliveryId: string, notify: NotifyCourier): Promise<void> {
  const config = await loadDispatchConfig(db);
  if (!config.enabled) return;
  const orderRef = db.collection("deliveries").doc(deliveryId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) return;
  const order = orderDoc.data()!;
  if (order.status !== "PENDING" || order.orderKind !== "MARKETPLACE" || order.dispatchState === "OPEN_POOL") return;
  if (Number(order.assignmentAttemptCount || 0) >= config.maxAssignmentAttempts) {
    if (config.fallbackToOpenPool) await moveToOpenPool(db, deliveryId, "MAX_ATTEMPTS", notify);
    return;
  }
  console.log(`[DISPATCH] Order ${deliveryId}: searching candidates with H3`);
  const result = await findCandidates(db, order, config);
  console.log(`[DISPATCH] Order ${deliveryId}: ${result.candidates.length} candidates passed constraints`);
  if (result.candidates.length === 0) {
    await appendHistory(db, deliveryId, result.history);
    if (config.fallbackToOpenPool) await moveToOpenPool(db, deliveryId, "NO_ELIGIBLE_COURIERS", notify);
    return;
  }
  for (const candidate of result.candidates) {
    if (await offerCandidate(db, deliveryId, candidate, config, result.history, notify)) return;
  }
  if (config.fallbackToOpenPool) await moveToOpenPool(db, deliveryId, "NO_REMAINING_CANDIDATES", notify);
}

export async function reassignOrder(
  db: Firestore,
  deliveryId: string,
  courierId: string,
  reason: "DECLINED" | "EXPIRED" | "UNAVAILABLE",
  notify: NotifyCourier
): Promise<void> {
  const ref = db.collection("deliveries").doc(deliveryId);
  const changed = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const order = snapshot.data()!;
    if (order.status !== "PENDING" || order.dispatchState !== "OFFERED" || order.offerCourierId !== courierId) return false;
    transaction.update(ref, {dispatchState: "REASSIGNING", offerCourierId: null, offerExpiresAt: null,
      availableCourierIds: [], lastReassignmentReason: reason, lastReassignedAt: Date.now()});
    return true;
  });
  if (!changed) return;
  await appendHistory(db, deliveryId, [{courierId, courierName: "", score: 0, distanceMeters: 0, etaSeconds: 0,
    etaSource: "", activeOrders: 0, idleTimeSeconds: 0, h3Cell: "", event: reason === "DECLINED" ? "DECLINED" : "EXPIRED",
    reason, at: Date.now()}]);
  console.log(`[DISPATCH] Reassigning order ${deliveryId}: ${reason}`);
  await dispatchOrder(db, deliveryId, notify);
}

export async function expireOutstandingOffers(db: Firestore, notify: NotifyCourier): Promise<number> {
  const offers = await db.collection("deliveries").where("status", "==", "PENDING")
    .where("dispatchState", "==", "OFFERED").get();
  const now = Date.now();
  const expired = offers.docs.filter(doc => Number(doc.data().offerExpiresAt || 0) <= now);
  await Promise.all(expired.map(doc => reassignOrder(db, doc.id, String(doc.data().offerCourierId || ""), "EXPIRED", notify)));
  return expired.length;
}

/** Uses an already-built cost matrix; geography and constraints remain outside Hungarian. */
export async function dispatchBatch(db: Firestore, deliveryIds: string[], notify: NotifyCourier): Promise<void> {
  const config = await loadDispatchConfig(db);
  if (!config.enabled || !config.batchAssignmentEnabled || deliveryIds.length < 2) {
    await Promise.all(deliveryIds.map(id => dispatchOrder(db, id, notify)));
    return;
  }
  const orders = await Promise.all(deliveryIds.map(async id => ({id, doc: await db.collection("deliveries").doc(id).get()})));
  const searches = await Promise.all(orders.map(async entry => entry.doc.exists
    ? findCandidates(db, entry.doc.data()!, config) : {candidates: [], history: []}));
  const courierIds = [...new Set(searches.flatMap(result => result.candidates.map(candidate => candidate.id)))];
  const impossible = 1e12;
  const matrix = searches.map(result => courierIds.map(id => result.candidates.find(candidate => candidate.id === id)?.score ?? impossible));
  const assignments = hungarianAssignment(matrix);
  const assignedRows = new Set<number>();
  for (const assignment of assignments) {
    const candidate = searches[assignment.row]?.candidates.find(item => item.id === courierIds[assignment.column]);
    if (candidate && candidate.score < impossible && await offerCandidate(db, orders[assignment.row].id, candidate, config,
      searches[assignment.row].history, notify)) assignedRows.add(assignment.row);
  }
  await Promise.all(orders.filter((_, index) => !assignedRows.has(index)).map(entry => dispatchOrder(db, entry.id, notify)));
}
