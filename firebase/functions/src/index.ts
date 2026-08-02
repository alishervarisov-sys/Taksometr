import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

admin.initializeApp();

const db = admin.firestore();

type AdminOrderStage =
  | "NEW"
  | "ACCEPTED"
  | "ARRIVED_PICKUP"
  | "PICKED_UP"
  | "ON_THE_WAY"
  | "ARRIVED_DESTINATION"
  | "COMPLETED"
  | "CANCELLED";

interface DeliveryTariffSnapshot {
  baseCost: number;
  baseDistanceKm: number;
  costPerKm: number;
  freeWaitingMinutes: number;
  costPerWaitingMinute: number;
}

// Helper function to verify admin or super admin
function verifyAdmin(adminId: string): Promise<void> {
  if (adminId === "SUPER_ADMIN") {
    return Promise.resolve();
  }
  
  return db.collection("users").doc(adminId).get().then(adminDoc => {
    if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
      throw new functions.https.HttpsError("permission-denied", "Only admins");
    }
  });
}

// ============ PAYOM.TJ SMS INTEGRATION ============
// Credentials are read from environment variables (functions/.env) so the
// JWT token is never committed to source control or shipped to clients.
const PAYOM_API_HOST = process.env.PAYOM_API_HOST || "https://gateway.payom.tj";
const PAYOM_API_TOKEN = process.env.PAYOM_API_TOKEN || "";
const PAYOM_SENDER_NAME = process.env.PAYOM_SENDER_NAME || "ZaKi";

/**
 * Normalize a phone number to the +992XXXXXXXXX format required by Payom.tj.
 * Returns null if the number cannot be normalized to a valid Tajik MSISDN.
 */
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;

  // Keep only digits and a leading plus sign
  let digits = String(raw).replace(/[^\d+]/g, "");
  digits = digits.replace(/(?!^)\+/g, ""); // remove any '+' that is not first

  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  // Strip leading international/trunk prefixes
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("992")) {
    // Already has country code: expect 992 + 9 national digits = 12
    digits = digits.replace(/^992/, "");
  } else if (digits.startsWith("0")) {
    // Local format with trunk 0
    digits = digits.slice(1);
  }

  // National number for Tajikistan is 9 digits
  if (!/^\d{9}$/.test(digits)) {
    return null;
  }

  return `+992${digits}`;
}

/**
 * Send an SMS via the Payom.tj REST API.
 * Never throws: failures are logged so they cannot break the delivery flow.
 */
async function sendSms(telephoneRaw: string, text: string): Promise<void> {
  const telephone = normalizePhone(telephoneRaw);

  if (!telephone) {
    console.warn(`SMS skipped: invalid phone number "${telephoneRaw}"`);
    return;
  }

  if (!PAYOM_API_TOKEN) {
    console.warn("SMS skipped: PAYOM_API_TOKEN is not configured");
    return;
  }

  try {
    const response = await fetch(`${PAYOM_API_HOST}/api/message`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PAYOM_API_TOKEN}`,
      },
      body: JSON.stringify({
        telephone: telephone,
        text: text,
        senderName: PAYOM_SENDER_NAME,
        type: "SMS",
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(
        `Payom.tj SMS failed (${response.status}) for ${telephone}: ${errBody}`
      );
      return;
    }

    const result = await response.json().catch(() => ({}));
    console.log(`SMS sent to ${telephone}, id=${(result as {id?: string}).id ?? "?"}`);
  } catch (e) {
    console.error("Payom.tj SMS request error:", e);
  }
}

/**
 * Format a cost value (somoni) for SMS text with dirams if present.
 */
function formatCostForSms(cost: number): string {
  const somoni = Math.floor(cost);
  const diram = Math.round((cost - somoni) * 100);
  if (diram > 0) {
    return `${new Intl.NumberFormat("ru-RU").format(somoni)}.${String(diram).padStart(2, "0")}`;
  }
  return new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 0}).format(cost);
}

// ============ CLIENT RATING (отзывы) ============
/**
 * Base URL of the public rateDelivery HTTP endpoint. Configurable via the
 * RATING_BASE_URL env var; falls back to the default Cloud Functions URL built
 * from the current project id.
 */
function getRatingBaseUrl(): string {
  if (process.env.RATING_BASE_URL) return process.env.RATING_BASE_URL;
  const project =
    process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
  return `https://us-central1-${project}.cloudfunctions.net/rateDelivery`;
}

/** Generates a short opaque token used to authorize a single rating link. */
function generateRatingToken(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Escapes user-provided text before embedding it into the rating HTML page. */
function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============ HAVERSINE DISTANCE CALCULATION ============
function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Maximum number of deliveries a courier may have IN_PROGRESS at once. One is
// the "current" (meter running) order; the rest are paused. Keep in sync with
// the Android app's Constants.MAX_CONCURRENT_DELIVERIES.
const MAX_CONCURRENT_DELIVERIES = 2;

function calculateRouteDistance(
  route: Array<{latitude: number; longitude: number; gap?: boolean}>
): number {
  let totalDistance = 0;
  for (let i = 1; i < route.length; i++) {
    // Skip the segment ending at a "gap" point (recorded when a paused delivery
    // is resumed) so travel done while serving another order isn't counted.
    if (route[i] && route[i].gap) continue;
    totalDistance += haversineDistance(
      route[i - 1].latitude, route[i - 1].longitude,
      route[i].latitude, route[i].longitude
    );
  }
  return totalDistance;
}

// ============ COST CALCULATION WITH DISTANCE THRESHOLD ============
// Base cost applies up to baseDistanceKm. Beyond that, costPerKm is charged
// for each kilometer over the threshold.
function computeCost(
  distanceMeters: number,
  baseCost: number,
  baseDistanceKm: number,
  costPerKm: number
): number {
  const distanceKm = distanceMeters / 1000;
  let cost = baseCost;
  if (distanceKm > baseDistanceKm) {
    cost += (distanceKm - baseDistanceKm) * costPerKm;
  }
  // Round to 2 decimal places for exact diram precision
  return Math.max(baseCost, Math.round(cost * 100) / 100);
}

function getEtaMinutes(from: any, to: any): number | null {
  if (
    !from ||
    !to ||
    typeof from.latitude !== "number" ||
    typeof from.longitude !== "number" ||
    typeof to.latitude !== "number" ||
    typeof to.longitude !== "number"
  ) {
    return null;
  }

  const distanceMeters = haversineDistance(
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude
  );
  const averageSpeedMps = 8.33;
  return Math.max(1, Math.ceil(distanceMeters / averageSpeedMps / 60));
}

async function getDefaultTariffSnapshot(): Promise<DeliveryTariffSnapshot> {
  const tariffDoc = await db.collection("tariffs").doc("default").get();
  const tariffData = tariffDoc.exists ? tariffDoc.data()! : {};

  return {
    baseCost: tariffData.baseCost || 5000,
    baseDistanceKm: tariffData.baseDistanceKm ?? 3,
    costPerKm: tariffData.costPerKm || 1500,
    freeWaitingMinutes: tariffData.freeWaitingMinutes ?? 5,
    costPerWaitingMinute: tariffData.costPerWaitingMinute ?? 500,
  };
}

async function sendPushToCourier(courierData: any, payload: {
  title: string;
  body: string;
  data: {[key: string]: string};
}, options?: {
  // When true, also include an FCM `notification` block so Android shows the
  // notification in the system tray even when the app is fully closed (killed
  // / swiped away). Use this for one-off announcements that MUST be delivered
  // (e.g. winner of the month). Leave false for real-time/data-only signals
  // that rely on onMessageReceived() waking the app.
  withSystemNotification?: boolean;
}): Promise<void> {
  const fcmToken = courierData?.fcmToken;
  if (!fcmToken) {
    console.warn("sendPushToCourier: fcmToken is empty, skipping");
    return;
  }

  try {
    const message: admin.messaging.Message = {
      token: fcmToken,
      // Data is always included so onMessageReceived() can react (foreground)
      // and carry the payload type/ids.
      data: {
        ...payload.data,
        title: payload.title,
        body: payload.body,
      },
      android: {
        priority: "high",
      },
    };

    if (options?.withSystemNotification) {
      // Guaranteed delivery: the OS renders this even when the app is killed.
      message.notification = {
        title: payload.title,
        body: payload.body,
      };
      message.android = {
        priority: "high",
        notification: {
          channelId: "zaki_notifications",
          sound: "default",
        },
      };
    }

    await admin.messaging().send(message);
  } catch (e) {
    console.error("FCM send error:", e);
  }
}

// ============ COURIER STATUS SYNCHRONIZATION ============
/**
 * Synchronise le statut isOnline d'un coursier en fonction de ses livraisons actives.
 * 
 * Règle métier :
 * - Si le coursier a au moins une livraison IN_PROGRESS → isOnline = true
 * - Si le coursier a au moins une chaîne IN_PROGRESS → isOnline = true
 * - Sinon → isOnline = false (aucune activité en cours)
 * 
 * Logge chaque changement de statut avec la raison détaillée.
 * 
 * PROTECTION: Cette fonction est la SEULE source de vérité pour le statut isOnline.
 * Toute modification de isOnline doit passer par cette fonction.
 */
async function syncCourierStatus(courierId: string, reason: string): Promise<void> {
  console.log(`[STATUS_SYNC] Checking status for courier ${courierId}. Reason: ${reason}`);

  const courierRef = db.collection("users").doc(courierId);
  const courierDoc = await courierRef.get();

  if (!courierDoc.exists) {
    console.warn(`[STATUS_SYNC] Courier ${courierId} not found. Skipping sync.`);
    return;
  }

  const courierData = courierDoc.data()!;

  // Check for active deliveries
  const activeDeliveries = await db.collection("deliveries")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  // Check for active chains
  const activeChains = await db.collection("delivery_chains")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  const hasActiveDelivery = !activeDeliveries.empty;
  const hasActiveChain = !activeChains.empty;
  const shouldBeOnline = hasActiveDelivery || hasActiveChain;
  const currentIsOnline = courierData.isOnline || false;

  if (shouldBeOnline === currentIsOnline) {
    console.log(
      `[STATUS_SYNC] Courier ${courierId} status unchanged: isOnline=${currentIsOnline}. ` +
      `activeDeliveries=${activeDeliveries.size}, activeChains=${activeChains.size}. Reason: ${reason}`
    );
    return;
  }

  // Status needs to change
  console.log(
    `[STATUS_SYNC] CHANGING courier ${courierId}: isOnline ${currentIsOnline} → ${shouldBeOnline}. ` +
    `Reason: ${reason}. ` +
    `activeDeliveries=${activeDeliveries.size}, activeChains=${activeChains.size}`
  );

  await courierRef.update({
    isOnline: shouldBeOnline,
    lastStatusChange: {
      from: currentIsOnline,
      to: shouldBeOnline,
      reason: reason,
      timestamp: Date.now(),
      activeDeliveries: activeDeliveries.size,
      activeChains: activeChains.size,
    },
  });

  console.log(
    `[STATUS_SYNC] SUCCESS: Courier ${courierId} isOnline updated to ${shouldBeOnline}. ` +
    `Reason: ${reason}`
  );
}

// ============ CREATE DELIVERY ============
export const createDelivery = functions.https.onCall(async (data, context) => {
  const {courierId, clientPhone, deliveryType} = data;

  if (!courierId || !clientPhone) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "courierId and clientPhone are required"
    );
  }

  // Get courier info
  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  if (courierData.isBlocked) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Courier is blocked"
    );
  }

  // Check courier balance (minimum 5 somoni required)
  const courierBalance = courierData.balance || 0;
  if (courierBalance < 5) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Недостаточно средств на балансе. Минимум 5 сомони для начала доставки."
    );
  }

  // Validate delivery type and get fixed price if applicable
  let fixedPrice: number | null = null;
  let deliveryTypeName = "";
  let actualDeliveryType = deliveryType || "default";
  
  console.log("=== CREATE DELIVERY DEBUG ===");
  console.log("Received deliveryType:", deliveryType);
  console.log("actualDeliveryType:", actualDeliveryType);
  
  if (deliveryType && deliveryType !== "default") {
    const tariffDoc = await db.collection("tariffs").doc("default").get();
    console.log("Tariff doc exists:", tariffDoc.exists);
    
    if (deliveryType === "heavyCargoMeter") {
      // Heavy cargo metered delivery — works like "default" but with its own tariff
      // No fixed price; cost is calculated by meter using heavyCargoMeter tariff settings
      deliveryTypeName = "Бори вазнин (аз рӯи ҳисобгар)";
      console.log("Heavy cargo metered delivery — no fixedPrice, meter will use separate tariff");
    } else if (tariffDoc.exists) {
      const fixedTypes = tariffDoc.data()!.fixedTypes || {};
      console.log("Fixed types:", fixedTypes);
      console.log("Looking for:", deliveryType);
      console.log("Found price:", fixedTypes[deliveryType]);
      
      if (fixedTypes[deliveryType] !== undefined && fixedTypes[deliveryType] > 0) {
        fixedPrice = fixedTypes[deliveryType];
        
        // Map type to display name (Tajik)
        const typeNames: {[key: string]: string} = {
          coal: "Ангишт",
          gas15: "Газ то 15 литр",
          gas30: "Газ то 30 литр",
          gas30plus: "Газ зиёда аз 30 литр",
          errands: "Гуногун супоришҳо",
          heavyCargo: "Бори вазнин",
        };
        deliveryTypeName = typeNames[deliveryType] || deliveryType;
        console.log("Set fixedPrice:", fixedPrice, "deliveryTypeName:", deliveryTypeName);
      } else {
        console.log("Price is 0 or undefined, using default");
        actualDeliveryType = "default";
      }
    }
  }
  
  console.log("Final: actualDeliveryType=", actualDeliveryType, "fixedPrice=", fixedPrice);
  console.log("=============================");

  // ---- TRANSACTION: atomically check active count and create delivery ----
  // This prevents the race condition where two simultaneous requests both
  // pass the active-delivery check and create duplicate records.
  const deliveryRef = db.collection("deliveries").doc();

  await db.runTransaction(async (transaction) => {
    const activeDeliveries = await transaction.get(
      db.collection("deliveries")
        .where("courierId", "==", courierId)
        .where("status", "==", "IN_PROGRESS")
    );

    if (activeDeliveries.size >= MAX_CONCURRENT_DELIVERIES) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Courier already has the maximum number of active deliveries"
      );
    }

    const deliveryData = {
      courierId: courierId,
      courierName: courierData.name || "",
      clientPhone: clientPhone,
      status: "IN_PROGRESS",
      startTime: Date.now(),
      endTime: null,
      distanceMeters: 0,
      cost: 0,
      route: [],
      deliveryType: actualDeliveryType,
      fixedPrice: fixedPrice,
      createdAt: Date.now(),
    };

    console.log("Saving delivery to Firestore (inside transaction):", deliveryData);
    transaction.set(deliveryRef, deliveryData);
  });

  // ---- Sync courier status: delivery IN_PROGRESS → courier must be ONLINE ----
  await syncCourierStatus(courierId, "createDelivery: new delivery set to IN_PROGRESS");

  // ---- Notify client by SMS that the courier started (Tajik) ----
  const courierName = courierData.name || "";
  const courierPhone = courierData.phone || "";
  
  let startSmsText = `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. `;
  startSmsText += `Расонанда: ${courierName}`;
  
  if (courierPhone) {
    startSmsText += `, тел: ${courierPhone}`;
  }
  
  startSmsText += `.`;
  
  if (fixedPrice !== null && fixedPrice > 0) {
    startSmsText += ` Навъи хидмат: ${deliveryTypeName}. Нархи қатъӣ: ${formatCostForSms(fixedPrice)} сомонӣ.`;
  } else if (actualDeliveryType === "heavyCargoMeter") {
    startSmsText += ` Навъи хидмат: ${deliveryTypeName}. Пардохт аз рӯи ҳисобгар.`;
  }

  // Append real-time tracking link so the client can follow the courier on Google Maps
  const trackingUrl = `https://zakitaksometr.web.app/track?d=${deliveryRef.id}`;
  startSmsText += ` Расонандаро дар харита пайгирӣ кунед: ${trackingUrl}`;

  await sendSms(clientPhone, startSmsText);

  return {
    deliveryId: deliveryRef.id,
    courierName: courierData.name || "",
    deliveryType: actualDeliveryType,
    fixedPrice: fixedPrice,
  };
});

// ============ COMPLETE DELIVERY ============
export const completeDelivery = functions.https.onCall(async (data, context) => {
  const {deliveryId, courierId, route, endTime, waitingMinutes} = data;

  if (!deliveryId || !courierId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId and courierId are required"
    );
  }

  // Get delivery
  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();

  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;

  if (deliveryData.courierId !== courierId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized to complete this delivery"
    );
  }

  if (deliveryData.status !== "IN_PROGRESS") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Delivery is not in progress"
    );
  }

  // Check if this is a fixed-price delivery
  const deliveryType = deliveryData.deliveryType || "default";
  const fixedPrice = deliveryData.fixedPrice;
  
  let totalCost: number;
  let distanceMeters = 0;
  let waitingCost = 0;
  let roundedCost = 0;
  
  if (deliveryType !== "default" && deliveryType !== "heavyCargoMeter" && fixedPrice !== null && fixedPrice !== undefined) {
    // Fixed price delivery - no calculation needed
    totalCost = fixedPrice;
    distanceMeters = 0;
  } else {
    // Calculate distance from route
    const routePoints = route || [];
    distanceMeters = calculateRouteDistance(routePoints);

    // Get tariff
    const tariffDoc = await db.collection("tariffs").doc("default").get();
    let baseCost = 5000;
    let baseDistanceKm = 3;
    let costPerKm = 1500;

    if (tariffDoc.exists) {
      const tariffData = tariffDoc.data()!;
      
      if (deliveryType === "heavyCargoMeter") {
        // Use heavy cargo metered tariff
        const hcm = tariffData.heavyCargoMeter || {};
        baseCost = hcm.baseCost ?? 15;
        baseDistanceKm = hcm.baseDistanceKm ?? 3;
        costPerKm = hcm.costPerKm ?? 4;
      } else {
        // Default metered tariff
        baseCost = tariffData.baseCost || 5000;
        baseDistanceKm = tariffData.baseDistanceKm ?? 3;
        costPerKm = tariffData.costPerKm || 1500;
      }
    }

    // Calculate cost: base covers baseDistanceKm, then costPerKm beyond
    roundedCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);

    // Calculate waiting cost
    const freeWaitingMinutes = tariffDoc.exists
      ? (tariffDoc.data()!.freeWaitingMinutes ?? 5)
      : 5;
    const costPerWaitingMinute = tariffDoc.exists
      ? (tariffDoc.data()!.costPerWaitingMinute ?? 500)
      : 500;

    const actualWaitingMinutes = waitingMinutes || 0;
    if (actualWaitingMinutes > freeWaitingMinutes) {
      waitingCost = Math.round((actualWaitingMinutes - freeWaitingMinutes) * costPerWaitingMinute * 100) / 100;
    }

    totalCost = roundedCost + waitingCost;
  }

  const routePoints = route || [];

  // ---- Commission logic ----
  // Per-courier commission takes priority over global setting
  const courierRef = db.collection("users").doc(courierId);
  const courierDoc2 = await courierRef.get();
  const courierData2 = courierDoc2.exists ? courierDoc2.data()! : {};

  // Check courier-specific commission first, then fall back to global
  let commissionPercent: number;
  if (courierData2.commissionPercent !== undefined && courierData2.commissionPercent !== null) {
    commissionPercent = courierData2.commissionPercent;
  } else {
    const settingsDoc = await db.collection("settings").doc("commission").get();
    commissionPercent = settingsDoc.exists
      ? (settingsDoc.data()!.percent || 0)
      : 0;
  }
  // Exact commission — no rounding, preserve dirams for transparency
  const commissionAmount = Math.round((totalCost * commissionPercent / 100) * 100) / 100;

  // Deduct commission from courier balance
  const currentBalance = courierData2.balance || 0;
  const newBalance = currentBalance - commissionAmount;

  await courierRef.update({balance: newBalance});

  // Record commission transaction
  if (commissionAmount > 0) {
    await db.collection("transactions").add({
      courierId: courierId,
      courierName: deliveryData.courierName || "",
      type: "COMMISSION",
      amount: -commissionAmount,
      deliveryId: deliveryId,
      balanceAfter: newBalance,
      description: `Комиссия ${commissionPercent}% за доставку`,
      createdAt: Date.now(),
    });
  }

  // Rating token — lets the client rate this delivery exactly once via SMS link.
  const ratingToken = generateRatingToken();

  // Update delivery
  await deliveryRef.update({
    status: "COMPLETED",
    endTime: endTime || Date.now(),
    distanceMeters: distanceMeters,
    cost: totalCost,
    waitingMinutes: waitingMinutes || 0,
    waitingCost: waitingCost,
    commission: commissionAmount,
    route: routePoints,
    ratingToken: ratingToken,
    ratingRequestedAt: Date.now(),
    rating: null,
  });

    // ---- Sync courier status after completing this delivery ----
  await syncCourierStatus(courierId, "completeDelivery: delivery status changed to COMPLETED");

  // ---- Push commission data to ZaKi Rashod for analytics (fire-and-forget) ----
  try {
    const zakiRashodUrl = process.env.ZAKI_RASHOD_COMMISSION_URL || "";
    const zakiRashodApiKey = process.env.ZAKI_RASHOD_API_KEY || "";
    if (zakiRashodUrl && commissionAmount > 0) {
      const payload = {
        source: "taksometr",
        orderId: deliveryId,
        driverId: courierId,
        driverName: deliveryData.courierName || "Неизвестный",
        commissionAmount: commissionAmount,
        orderAmount: totalCost,
        commissionPercent: commissionPercent,
        orderType: deliveryType || "default",
        completedAt: new Date(deliveryData.createdAt || Date.now()).toISOString(),
      };

      const pushResponse = await fetch(zakiRashodUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(zakiRashodApiKey ? { "x-api-key": zakiRashodApiKey } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!pushResponse.ok) {
        const errText = await pushResponse.text().catch(() => "");
        console.error(`ZaKi Rashod commission push failed (${pushResponse.status}): ${errText}`);
      } else {
        console.log(`ZaKi Rashod commission push success for deliveryId=${deliveryId}`);
      }
    } else if (!zakiRashodUrl) {
      console.warn("ZAKI_RASHOD_COMMISSION_URL is not set, skipping commission push");
    }
  } catch (pushErr) {
    // Ошибка отправки не должна блокировать завершение доставки
    console.error("Ошибка отправки комиссии в ZaKi Rashod:", pushErr);
  }

  // ---- Notify client by SMS about the final delivery total (Tajik) ----
  let completeSmsText = `Фармоиши ZaKi анҷом ёфт. `;
  
  if (deliveryType !== "default" && fixedPrice !== null && fixedPrice !== undefined) {
    // Fixed price delivery - simple message
    const typeNames: {[key: string]: string} = {
      coal: "Ангишт",
      gas15: "Газ то 15 литр",
      gas30: "Газ то 30 литр",
      gas30plus: "Газ зиёда аз 30 литр",
      errands: "Гуногун супоришҳо",
      heavyCargo: "Бори вазнин",
    };
    const typeName = typeNames[deliveryType] || deliveryType;
    completeSmsText += `Навъи хидмат: ${typeName}. `;
  } else {
    // Regular counter-based delivery - show distance
    const distanceKmText = (distanceMeters / 1000).toFixed(1);
    completeSmsText += `Масофа: ${distanceKmText} км. `;
    
    if (waitingCost > 0) {
      const actualWaitingMinutes = waitingMinutes || 0;
      const waitingMinsRounded = Math.ceil(actualWaitingMinutes);
      completeSmsText +=
        `Интизорӣ: ${waitingMinsRounded} дақ. (${formatCostForSms(waitingCost)} сомонӣ). `;
    }
  }

  const ratingUrl =
    `${getRatingBaseUrl()}?d=${encodeURIComponent(deliveryId)}&t=${ratingToken}`;

  completeSmsText +=
    `Маблағи умумӣ: ${formatCostForSms(totalCost)} сомонӣ. ` +
    `Ба хизматрасонӣ баҳо диҳед: ${ratingUrl} ` +
    `Барои хариди хӯрок, дору ва дигар молҳо барномаи ZaKi-ро боргирӣ кунед: https://clck.ru/3TuGb6 ` +
    `Ташаккур!`;

  await sendSms(deliveryData.clientPhone, completeSmsText);

  return {
    deliveryId: deliveryId,
    clientPhone: deliveryData.clientPhone,
    courierName: deliveryData.courierName,
    startTime: deliveryData.startTime,
    endTime: endTime || Date.now(),
    distanceMeters: distanceMeters,
    cost: totalCost,
    waitingMinutes: waitingMinutes || 0,
    waitingCost: waitingCost,
    commission: commissionAmount,
  };
});

// ============ CLIENT RATING PAGE (public HTTP) ============
/**
 * Public endpoint the client opens from the SMS link to rate a completed
 * delivery. GET without `s` renders a 1–5 star page; GET with `s` records the
 * score (and optional comment `c`), updates the courier's aggregate rating and
 * shows a thank-you page. The single-use `t` token authorizes the rating.
 */
export const rateDelivery = functions.https.onRequest(async (req, res) => {
  const deliveryId = String(req.query.d || "");
  const token = String(req.query.t || "");
  const scoreRaw = req.query.s != null ? String(req.query.s) : "";
  const comment = String(req.query.c || "").slice(0, 500);

  const page = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#212121}
  .card{max-width:420px;margin:24px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  h1{font-size:20px;margin:0 0 8px}
  p{color:#555;line-height:1.5}
  .stars{display:flex;justify-content:center;gap:8px;margin:20px 0}
  .stars a{font-size:40px;text-decoration:none;color:#FFC107;transition:transform .1s}
  .stars a:hover{transform:scale(1.15)}
  textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:12px;padding:10px;font-size:15px;min-height:80px}
  button{margin-top:14px;width:100%;padding:14px;border:0;border-radius:12px;background:#1565C0;color:#fff;font-size:16px;font-weight:600}
  .big{font-size:56px;text-align:center;margin:8px 0}
</style></head><body><div class="card">${body}</div></body></html>`;

  const errorPage = (msg: string): void => {
    res.status(200).send(page("ZaKi", `<h1>ZaKi</h1><p>${escapeHtml(msg)}</p>`));
  };

  try {
    if (!deliveryId || !token) {
      return errorPage("Ссылка недействительна.");
    }

    const deliveryRef = db.collection("deliveries").doc(deliveryId);
    const deliveryDoc = await deliveryRef.get();
    if (!deliveryDoc.exists) {
      return errorPage("Заказ не найден.");
    }
    const d = deliveryDoc.data()!;
    if (!d.ratingToken || d.ratingToken !== token) {
      return errorPage("Ссылка недействительна или устарела.");
    }
    if (d.rating != null) {
      return errorPage("Спасибо! Вы уже оценили эту доставку.");
    }

    // No score yet — show the star selection form.
    if (!scoreRaw) {
      const starLinks = [1, 2, 3, 4, 5]
        .map((n) => `<a href="?d=${encodeURIComponent(deliveryId)}&t=${encodeURIComponent(token)}&s=${n}" title="${n}">&#9733;</a>`)
        .join("");
      const body = `
        <h1>Оцените доставку ZaKi</h1>
        <p>Насколько вы довольны курьером${d.courierName ? " " + escapeHtml(d.courierName) : ""}? Выберите оценку:</p>
        <div class="stars">${starLinks}</div>
        <form method="GET" action="">
          <input type="hidden" name="d" value="${escapeHtml(deliveryId)}">
          <input type="hidden" name="t" value="${escapeHtml(token)}">
          <input type="hidden" name="s" value="5">
          <textarea name="c" placeholder="Комментарий (необязательно)"></textarea>
          <button type="submit">Отправить с оценкой 5 &#9733;</button>
        </form>`;
      res.status(200).send(page("Оцените доставку ZaKi", body));
      return;
    }

    const score = parseInt(scoreRaw, 10);
    if (isNaN(score) || score < 1 || score > 5) {
      return errorPage("Некорректная оценка.");
    }

    const courierId = d.courierId || "";

    // Record the rating on the delivery and update the courier aggregate
    // atomically so concurrent ratings don't clobber the running average.
    await db.runTransaction(async (tx) => {
      const freshDelivery = await tx.get(deliveryRef);
      const fd = freshDelivery.data();
      // Re-check inside the transaction to prevent double submissions.
      if (!fd || fd.rating != null || fd.ratingToken !== token) {
        return;
      }

      tx.update(deliveryRef, {
        rating: score,
        ratingComment: comment,
        ratedAt: Date.now(),
      });

      if (courierId) {
        const courierRef = db.collection("users").doc(courierId);
        const courierDoc = await tx.get(courierRef);
        if (courierDoc.exists) {
          const cd = courierDoc.data()!;
          const ratingCount = (cd.ratingCount || 0) + 1;
          const ratingSum = (cd.ratingSum || 0) + score;
          tx.update(courierRef, {
            ratingCount: ratingCount,
            ratingSum: ratingSum,
            rating: Math.round((ratingSum / ratingCount) * 100) / 100,
          });
        }
      }
    });

    const body = `
      <div class="big">&#127881;</div>
      <h1>Спасибо за оценку!</h1>
      <p>Вы поставили ${score} &#9733;. Ваш отзыв помогает нам стать лучше.</p>`;
    res.status(200).send(page("Спасибо!", body));
    return;
  } catch (e) {
    console.error("rateDelivery error:", e);
    return errorPage("Произошла ошибка. Попробуйте позже.");
  }
});

// ============ CANCEL DELIVERY ============
export const cancelDelivery = functions.https.onCall(async (data, context) => {
  const {deliveryId, courierId} = data;

  if (!deliveryId || !courierId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId and courierId are required"
    );
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();

  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;

  if (deliveryData.courierId !== courierId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized"
    );
  }

    await deliveryRef.update({
    status: "CANCELLED",
    endTime: Date.now(),
  });

  // ---- Sync courier status after cancellation ----
  await syncCourierStatus(courierId, "cancelDelivery: delivery status changed to CANCELLED");

  return {success: true};
});

// ============ CALCULATE DELIVERY COST ============
export const calculateDeliveryCost = functions.https.onCall(async (data, context) => {
  const {distanceMeters} = data;

  if (distanceMeters === undefined || distanceMeters === null) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "distanceMeters is required"
    );
  }

  // Get tariff
  const tariffDoc = await db.collection("tariffs").doc("default").get();
  let baseCost = 5000;
  let baseDistanceKm = 3;
  let costPerKm = 1500;

  if (tariffDoc.exists) {
    const tariffData = tariffDoc.data()!;
    baseCost = tariffData.baseCost || 5000;
    baseDistanceKm = tariffData.baseDistanceKm ?? 3;
    costPerKm = tariffData.costPerKm || 1500;
  }

  const distanceKm = distanceMeters / 1000;
  const roundedCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);

  return {
    cost: roundedCost,
    baseCost: baseCost,
    baseDistanceKm: baseDistanceKm,
    costPerKm: costPerKm,
    distanceKm: distanceKm,
  };
});

// ============ ADMIN: CREATE MARKETPLACE DELIVERY ============
export const adminCreateMarketplaceDelivery = functions.https.onCall(async (data, context) => {
  const {
    adminId,
    clientPhone,
    comment,
    pickup,
    destination,
    courierId,
    deliveryType,
  } = data as {
    adminId: string;
    clientPhone: string;
    comment?: string;
    pickup: {address?: string; latitude: number; longitude: number};
    destination?: {address?: string; latitude: number; longitude: number} | null;
    // Optional: when provided, the order is created already assigned to this
    // courier (IN_PROGRESS) instead of being offered to the whole marketplace.
    courierId?: string | null;
    // Optional: the same delivery type a courier picks when starting the meter
    // ("default", "heavyCargoMeter", "coal", "gas15", "gas30", "gas30plus",
    // "errands", "heavyCargo"). Empty/omitted => "default" (metered).
    deliveryType?: string | null;
  };

  await verifyAdmin(adminId);

  if (!clientPhone || !pickup) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "clientPhone and pickup are required"
    );
  }

  if (
    typeof pickup.latitude !== "number" ||
    typeof pickup.longitude !== "number"
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "pickup coordinates are required"
    );
  }

  // destination is optional (may be filled in later by admin/courier)
  const hasDestination =
    destination &&
    typeof destination.latitude === "number" &&
    typeof destination.longitude === "number";

  // ---- Resolve delivery type + fixed price the SAME way createDelivery does,
  // so an admin-created order behaves exactly like a courier-started one.
  // "default"        -> metered by the normal tariff (no fixed price)
  // "heavyCargoMeter"-> metered by the heavy-cargo tariff (no fixed price)
  // fixed types      -> fixedPrice pulled from tariffs/default.fixedTypes
  let resolvedDeliveryType = deliveryType || "default";
  let fixedPrice: number | null = null;
  let deliveryTypeName = "";
  if (deliveryType && deliveryType !== "default") {
    if (deliveryType === "heavyCargoMeter") {
      resolvedDeliveryType = "heavyCargoMeter";
      deliveryTypeName = "Бори вазнин (аз рӯи ҳисобгар)";
    } else {
      const tariffDoc = await db.collection("tariffs").doc("default").get();
      const fixedTypes = tariffDoc.exists ? (tariffDoc.data()!.fixedTypes || {}) : {};
      if (fixedTypes[deliveryType] !== undefined && fixedTypes[deliveryType] > 0) {
        fixedPrice = fixedTypes[deliveryType];
        resolvedDeliveryType = deliveryType;
        const typeNames: {[key: string]: string} = {
          coal: "Ангишт",
          gas15: "Газ то 15 литр",
          gas30: "Газ то 30 литр",
          gas30plus: "Газ зиёда аз 30 литр",
          errands: "Гуногун супоришҳо",
          heavyCargo: "Бори вазнин",
        };
        deliveryTypeName = typeNames[deliveryType] || deliveryType;
      } else {
        // Unknown type or price not configured -> fall back to metered default.
        resolvedDeliveryType = "default";
      }
    }
  }

  // ---- Direct assignment path: create the order already tied to one courier.
  if (courierId) {
    const courierDoc = await db.collection("users").doc(courierId).get();
    if (!courierDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Courier not found");
    }
    const courierData = courierDoc.data()!;
    if (courierData.role !== "COURIER") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Selected user is not a courier"
      );
    }
    if (courierData.isBlocked) {
      throw new functions.https.HttpsError("permission-denied", "Courier is blocked");
    }

    const activeDeliveries = await db.collection("deliveries")
      .where("courierId", "==", courierId)
      .where("status", "==", "IN_PROGRESS")
      .get();
    if (activeDeliveries.size >= MAX_CONCURRENT_DELIVERIES) {
      throw new functions.https.HttpsError(
        "already-exists",
        "У курьера уже максимум активных заказов"
      );
    }

    const tariff = await getDefaultTariffSnapshot();
    const deliveryRef = db.collection("deliveries").doc();
    const now = Date.now();

    await deliveryRef.set({
      courierId,
      courierName: courierData.name || "",
      courierPhone: courierData.phone || "",
      clientPhone: clientPhone,
      status: "IN_PROGRESS",
      adminOrderStage: "ACCEPTED",
      orderSource: "ADMIN_PANEL",
      orderKind: "MARKETPLACE",
      startTime: now,
      acceptedAt: now,
      endTime: null,
      distanceMeters: 0,
      cost: 0,
      route: [],
      deliveryType: resolvedDeliveryType,
      fixedPrice: fixedPrice,
      createdAt: now,
      adminCreatedAt: now,
      adminId: adminId,
      comment: comment || "",
      pickup,
      destination: hasDestination ? destination : null,
      availableCourierIds: [courierId],
      assignedByAdmin: true,
      assignedByAdminId: adminId,
      waitingMinutes: 0,
      waitingCost: 0,
      waitingStartedAt: null,
      tariffSnapshot: tariff,
    });

    await syncCourierStatus(
      courierId,
      "adminCreateMarketplaceDelivery: order created and assigned by dispatcher"
    );

    await sendPushToCourier(courierData, {
      title: "Вам назначен заказ",
      body: pickup.address
        ? `Заказ: ${pickup.address}`
        : "Диспетчер назначил вам заказ",
      data: {type: "ADMIN_ASSIGNED_ORDER", deliveryId: deliveryRef.id},
    }, {withSystemNotification: true});

    const courierName = courierData.name || "";
    const courierPhone = courierData.phone || "";
    let smsText = `Салом! Курьери ZaKi фармоиши шуморо қабул кард. ${courierName}`;
    if (courierPhone) smsText += `, тел: ${courierPhone}`;
    smsText += `.`;
    if (fixedPrice !== null && fixedPrice > 0) {
      smsText += ` Навъи хидмат: ${deliveryTypeName}. Нархи қатъӣ: ${formatCostForSms(fixedPrice)} сомонӣ.`;
    } else if (resolvedDeliveryType === "heavyCargoMeter") {
      smsText += ` Навъи хидмат: ${deliveryTypeName}. Пардохт аз рӯи ҳисобгар.`;
    }
    await sendSms(clientPhone, smsText);

    return {
      success: true,
      deliveryId: deliveryRef.id,
      assignedCourierId: courierId,
      assignedCourierName: courierName,
      deliveryType: resolvedDeliveryType,
      fixedPrice: fixedPrice,
      availableCouriers: 1,
    };
  }

  const courierDocs = await db.collection("users")
    .where("role", "==", "COURIER")
    .where("isBlocked", "==", false)
    .get();

  const availableCourierIds: string[] = [];
  const availableCouriersDebug: Array<{
    id: string;
    name: string;
    phone: string;
  }> = [];
  for (const courierDoc of courierDocs.docs) {
    // Respect the courier's manual "on shift" switch. Couriers that explicitly
    // turned their shift off are excluded from new order distribution and push.
    // Missing field is treated as on-shift for backward compatibility.
    if (courierDoc.data()?.isOnShift === false) continue;
    availableCourierIds.push(courierDoc.id);
    availableCouriersDebug.push({
      id: courierDoc.id,
      name: courierDoc.data()?.name || "",
      phone: courierDoc.data()?.phone || "",
    });
  }

  const tariff = await getDefaultTariffSnapshot();
  const deliveryRef = db.collection("deliveries").doc();
  const now = Date.now();

  await deliveryRef.set({
    courierId: "",
    courierName: "",
    clientPhone: clientPhone,
    status: "PENDING",
    adminOrderStage: "NEW",
    orderSource: "ADMIN_PANEL",
    orderKind: "MARKETPLACE",
    startTime: null,
    acceptedAt: null,
    endTime: null,
    distanceMeters: 0,
    cost: 0,
    route: [],
    deliveryType: resolvedDeliveryType,
    fixedPrice: fixedPrice,
    createdAt: now,
    adminCreatedAt: now,
    adminId: adminId,
    comment: comment || "",
    pickup,
    destination: hasDestination ? destination : null,
    availableCourierIds,
    availableCouriersDebug,
    waitingMinutes: 0,
    waitingCost: 0,
    waitingStartedAt: null,
    tariffSnapshot: tariff,
  });

  for (const courierId of availableCourierIds) {
    const courierDoc = await db.collection("users").doc(courierId).get();
    if (!courierDoc.exists) continue;
    const courierData = courierDoc.data()!;

    await sendPushToCourier(courierData, {
      title: "Новый заказ",
      body: hasDestination
        ? `Заказ: ${pickup.address || "точка А"} → ${destination.address || "точка Б"}`
        : `Заказ: ${pickup.address || "точка А"}`,
      data: {
        type: "ADMIN_MARKETPLACE_ORDER",
        deliveryId: deliveryRef.id,
      },
    });
  }

  return {
    success: true,
    deliveryId: deliveryRef.id,
    deliveryType: resolvedDeliveryType,
    fixedPrice: fixedPrice,
    availableCouriers: availableCourierIds.length,
    availableCourierIds,
    availableCouriersDebug,
  };
});

export const acceptMarketplaceDelivery = functions.https.onCall(async (data, context) => {
  const {deliveryId, courierId} = data;

  if (!deliveryId || !courierId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId and courierId are required"
    );
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);

  const acceptanceResult = await db.runTransaction(async (transaction) => {
    const deliveryDoc = await transaction.get(deliveryRef);
    if (!deliveryDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Delivery not found");
    }

    const deliveryData = deliveryDoc.data()!;
    if (deliveryData.status !== "PENDING" || deliveryData.orderKind !== "MARKETPLACE") {
      const acceptedBy = deliveryData.courierName || "другой курьер";
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Delivery is no longer available. Accepted by: ${acceptedBy}`
      );
    }

    const availableCourierIds = deliveryData.availableCourierIds || [];
    if (!availableCourierIds.includes(courierId)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Courier is not eligible for this order"
      );
    }

    const courierRef = db.collection("users").doc(courierId);
    const courierDoc = await transaction.get(courierRef);
    if (!courierDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Courier not found");
    }

    const courierData = courierDoc.data()!;
    if (courierData.isBlocked) {
      throw new functions.https.HttpsError("permission-denied", "Courier is blocked");
    }

    const courierBalance = courierData.balance || 0;
    if (courierBalance < 5) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Недостаточно средств на балансе. Минимум 5 сомони."
      );
    }

    const activeDeliveries = await db.collection("deliveries")
      .where("courierId", "==", courierId)
      .where("status", "==", "IN_PROGRESS")
      .get();
    if (activeDeliveries.size >= MAX_CONCURRENT_DELIVERIES) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Courier already has the maximum number of active deliveries"
      );
    }

    const activeChains = await db.collection("delivery_chains")
      .where("courierId", "==", courierId)
      .where("status", "==", "IN_PROGRESS")
      .get();
    if (!activeChains.empty) {
      throw new functions.https.HttpsError("already-exists", "Courier already has an active chain");
    }

    const acceptedAt = Date.now();
    transaction.update(deliveryRef, {
      courierId,
      courierName: courierData.name || "",
      courierPhone: courierData.phone || "",
      status: "IN_PROGRESS",
      adminOrderStage: "ACCEPTED",
      acceptedAt,
      startTime: acceptedAt,
      availableCourierIds: [courierId],
    });

    return {
      courierData,
      deliveryData,
      acceptedAt,
    };
  });

  await syncCourierStatus(courierId, "acceptMarketplaceDelivery: order accepted by courier");

  const etaMinutes = getEtaMinutes(
    acceptanceResult.courierData.lastLocation,
    acceptanceResult.deliveryData.pickup
  );
  const courierName = acceptanceResult.courierData.name || "";
  const courierPhone = acceptanceResult.courierData.phone || "";

  let smsText = `Салом! Курьери ZaKi фармоиши шуморо қабул кард. ${courierName}`;
  if (courierPhone) {
    smsText += `, тел: ${courierPhone}`;
  }
  if (etaMinutes !== null) {
    smsText += `. Тахминан то шумо: ${etaMinutes} дақиқа`;
  }
  smsText += `.`;

  await sendSms(acceptanceResult.deliveryData.clientPhone, smsText);

  return {
    success: true,
    deliveryId,
    courierName,
    courierPhone,
    etaMinutes,
  };
});

// ============ ADMIN: ASSIGN A FREE ORDER TO A SPECIFIC COURIER ============
/**
 * Dispatcher hands a PENDING marketplace order directly to a chosen courier.
 * Moves the order to IN_PROGRESS for that courier (bypasses the balance minimum
 * since the dispatcher is deciding), notifies the courier by push and the client
 * by SMS.
 */
export const adminAssignOrderToCourier = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId, courierId} = data as {
    adminId: string; deliveryId: string; courierId: string;
  };

  await verifyAdmin(adminId);
  if (!deliveryId || !courierId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId and courierId are required");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);

  const result = await db.runTransaction(async (transaction) => {
    const deliveryDoc = await transaction.get(deliveryRef);
    if (!deliveryDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Delivery not found");
    }
    const deliveryData = deliveryDoc.data()!;
    if (deliveryData.status !== "PENDING") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Заказ уже не свободен (не в статусе PENDING)"
      );
    }

    const courierRef = db.collection("users").doc(courierId);
    const courierDoc = await transaction.get(courierRef);
    if (!courierDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Courier not found");
    }
    const courierData = courierDoc.data()!;
    if (courierData.isBlocked) {
      throw new functions.https.HttpsError("permission-denied", "Courier is blocked");
    }

    const activeDeliveries = await db.collection("deliveries")
      .where("courierId", "==", courierId)
      .where("status", "==", "IN_PROGRESS")
      .get();
    if (activeDeliveries.size >= MAX_CONCURRENT_DELIVERIES) {
      throw new functions.https.HttpsError(
        "already-exists",
        "У курьера уже максимум активных заказов"
      );
    }

    const acceptedAt = Date.now();
    transaction.update(deliveryRef, {
      courierId,
      courierName: courierData.name || "",
      courierPhone: courierData.phone || "",
      status: "IN_PROGRESS",
      orderKind: deliveryData.orderKind || "MARKETPLACE",
      adminOrderStage: "ACCEPTED",
      acceptedAt,
      startTime: acceptedAt,
      availableCourierIds: [courierId],
      assignedByAdmin: true,
      assignedByAdminId: adminId,
    });

    return {courierData, deliveryData};
  });

  await syncCourierStatus(courierId, "adminAssignOrderToCourier: order assigned by dispatcher");

  await sendPushToCourier(result.courierData, {
    title: "Вам назначен заказ",
    body: result.deliveryData.pickup?.address
      ? `Заказ: ${result.deliveryData.pickup.address}`
      : "Диспетчер назначил вам заказ",
    data: {type: "ADMIN_ASSIGNED_ORDER", deliveryId},
  }, {withSystemNotification: true});

  const courierName = result.courierData.name || "";
  const courierPhone = result.courierData.phone || "";
  let smsText = `Салом! Курьери ZaKi фармоиши шуморо қабул кард. ${courierName}`;
  if (courierPhone) smsText += `, тел: ${courierPhone}`;
  smsText += `.`;
  await sendSms(result.deliveryData.clientPhone, smsText);

  return {success: true, deliveryId, courierId, courierName};
});

// ============ ADMIN: REASSIGN AN ORDER TO ANOTHER COURIER ============
/**
 * Moves an order (PENDING or IN_PROGRESS) from its current courier to a new one.
 * Useful when a courier accepted an order by mistake. The previous courier is
 * released and notified; the new courier is assigned and notified.
 */
export const adminReassignOrder = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId, newCourierId} = data as {
    adminId: string; deliveryId: string; newCourierId: string;
  };

  await verifyAdmin(adminId);
  if (!deliveryId || !newCourierId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId and newCourierId are required");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);

  const result = await db.runTransaction(async (transaction) => {
    const deliveryDoc = await transaction.get(deliveryRef);
    if (!deliveryDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Delivery not found");
    }
    const deliveryData = deliveryDoc.data()!;
    if (deliveryData.status !== "PENDING" && deliveryData.status !== "IN_PROGRESS") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Переназначить можно только активный или свободный заказ"
      );
    }

    const previousCourierId = deliveryData.courierId || "";
    if (previousCourierId === newCourierId) {
      throw new functions.https.HttpsError("already-exists", "Заказ уже у этого курьера");
    }

    const courierRef = db.collection("users").doc(newCourierId);
    const courierDoc = await transaction.get(courierRef);
    if (!courierDoc.exists) {
      throw new functions.https.HttpsError("not-found", "Courier not found");
    }
    const courierData = courierDoc.data()!;
    if (courierData.isBlocked) {
      throw new functions.https.HttpsError("permission-denied", "Courier is blocked");
    }

    const activeDeliveries = await db.collection("deliveries")
      .where("courierId", "==", newCourierId)
      .where("status", "==", "IN_PROGRESS")
      .get();
    // Count excludes this delivery in case it's already assigned to the target.
    const activeCount = activeDeliveries.docs.filter(d => d.id !== deliveryId).length;
    if (activeCount >= MAX_CONCURRENT_DELIVERIES) {
      throw new functions.https.HttpsError("already-exists", "У курьера уже максимум активных заказов");
    }

    const now = Date.now();
    transaction.update(deliveryRef, {
      courierId: newCourierId,
      courierName: courierData.name || "",
      courierPhone: courierData.phone || "",
      status: "IN_PROGRESS",
      adminOrderStage: "ACCEPTED",
      acceptedAt: now,
      startTime: deliveryData.startTime || now,
      availableCourierIds: [newCourierId],
      reassignedByAdmin: true,
      reassignedByAdminId: adminId,
      previousCourierId,
    });

    return {courierData, deliveryData, previousCourierId};
  });

  // Sync both couriers' online status.
  if (result.previousCourierId) {
    await syncCourierStatus(result.previousCourierId, "adminReassignOrder: order removed from previous courier");
    const prevDoc = await db.collection("users").doc(result.previousCourierId).get();
    if (prevDoc.exists) {
      await sendPushToCourier(prevDoc.data()!, {
        title: "Заказ снят",
        body: "Диспетчер переназначил ваш заказ другому курьеру",
        data: {type: "ORDER_REASSIGNED_AWAY", deliveryId},
      }, {withSystemNotification: true});
    }
  }
  await syncCourierStatus(newCourierId, "adminReassignOrder: order assigned to new courier");
  await sendPushToCourier(result.courierData, {
    title: "Вам назначен заказ",
    body: result.deliveryData.pickup?.address
      ? `Заказ: ${result.deliveryData.pickup.address}`
      : "Диспетчер назначил вам заказ",
    data: {type: "ADMIN_ASSIGNED_ORDER", deliveryId},
  }, {withSystemNotification: true});

  return {success: true, deliveryId, newCourierId};
});

// ============ ADMIN: RELEASE AN ORDER BACK TO THE MARKETPLACE ============
/**
 * Resets an order back to a free (PENDING marketplace) state so any eligible
 * courier can pick it up again. Detaches the current courier and re-notifies all
 * on-shift couriers.
 */
export const adminReleaseOrderToMarketplace = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId} = data as {adminId: string; deliveryId: string};

  await verifyAdmin(adminId);
  if (!deliveryId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId is required");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();
  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }
  const deliveryData = deliveryDoc.data()!;
  if (deliveryData.status === "COMPLETED" || deliveryData.status === "CANCELLED") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Завершённый или отменённый заказ нельзя вернуть в свободные"
    );
  }

  const previousCourierId = deliveryData.courierId || "";

  // Rebuild the pool of eligible (non-blocked, on-shift) couriers.
  const courierDocs = await db.collection("users")
    .where("role", "==", "COURIER")
    .where("isBlocked", "==", false)
    .get();
  const availableCourierIds: string[] = [];
  for (const courierDoc of courierDocs.docs) {
    if (courierDoc.data()?.isOnShift === false) continue;
    availableCourierIds.push(courierDoc.id);
  }

  await deliveryRef.update({
    courierId: "",
    courierName: "",
    courierPhone: "",
    status: "PENDING",
    orderKind: "MARKETPLACE",
    adminOrderStage: "NEW",
    acceptedAt: null,
    startTime: null,
    availableCourierIds,
    releasedByAdmin: true,
    releasedByAdminId: adminId,
    releasedAt: Date.now(),
  });

  // The previously-assigned courier is now free again.
  if (previousCourierId) {
    await syncCourierStatus(previousCourierId, "adminReleaseOrderToMarketplace: order released back to marketplace");
    const prevDoc = await db.collection("users").doc(previousCourierId).get();
    if (prevDoc.exists) {
      await sendPushToCourier(prevDoc.data()!, {
        title: "Заказ снят",
        body: "Диспетчер вернул заказ в свободные",
        data: {type: "ORDER_RELEASED", deliveryId},
      }, {withSystemNotification: true});
    }
  }

  // Re-notify all eligible couriers that a free order is available.
  for (const courierId of availableCourierIds) {
    if (courierId === previousCourierId) continue;
    const courierDoc = await db.collection("users").doc(courierId).get();
    if (!courierDoc.exists) continue;
    await sendPushToCourier(courierDoc.data()!, {
      title: "Новый заказ",
      body: deliveryData.pickup?.address
        ? `Заказ: ${deliveryData.pickup.address}`
        : "Доступен новый заказ",
      data: {type: "ADMIN_MARKETPLACE_ORDER", deliveryId},
    });
  }

  return {success: true, deliveryId, availableCouriers: availableCourierIds.length};
});

export const updateMarketplaceDeliveryStage = functions.https.onCall(async (data, context) => {
  const {deliveryId, courierId, stage, waitingAction} = data as {
    deliveryId: string;
    courierId: string;
    stage?: AdminOrderStage;
    waitingAction?: "START" | "STOP";
  };

  if (!deliveryId || !courierId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId and courierId are required");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();
  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;
  if (deliveryData.courierId !== courierId) {
    throw new functions.https.HttpsError("permission-denied", "Not authorized");
  }
  if (deliveryData.orderKind !== "MARKETPLACE") {
    throw new functions.https.HttpsError("failed-precondition", "Not a marketplace delivery");
  }
  if (deliveryData.status !== "IN_PROGRESS") {
    throw new functions.https.HttpsError("failed-precondition", "Delivery is not in progress");
  }

  const now = Date.now();
  const updates: {[key: string]: any} = {};

  if (stage) {
    updates.adminOrderStage = stage;
    updates.lastStageUpdatedAt = now;
  }

  if (waitingAction === "START") {
    if (!deliveryData.waitingStartedAt) {
      updates.waitingStartedAt = now;
    }
  }

  if (waitingAction === "STOP") {
    const waitingStartedAt = deliveryData.waitingStartedAt || 0;
    if (waitingStartedAt > 0) {
      const extraWaitingMinutes = (now - waitingStartedAt) / 60000;
      updates.waitingMinutes = (deliveryData.waitingMinutes || 0) + extraWaitingMinutes;
      updates.waitingStartedAt = null;
    }
  }

  await deliveryRef.update(updates);

  // No SMS is sent on intermediate stage transitions (PICKED_UP / ON_THE_WAY).
  // The client is notified only twice: when the courier accepts the order
  // (acceptMarketplaceDelivery) and when the order is completed (completeDelivery).

  return {success: true};
});

// ============ ADMIN: UPDATE MARKETPLACE STAGE (fallback when courier is offline) ============
// Lets an admin set the stage of a marketplace order on behalf of a courier who
// has lost internet connectivity. Only the intermediate stages are handled here;
// use adminSetDeliveryStatus to COMPLETE or CANCEL an order. No SMS is sent on
// these intermediate transitions (same policy as the courier-driven flow).
export const adminUpdateMarketplaceStage = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId, stage} = data as {
    adminId: string;
    deliveryId: string;
    stage: AdminOrderStage;
  };

  await verifyAdmin(adminId);

  if (!deliveryId || !stage) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId and stage are required"
    );
  }

  const allowedStages: AdminOrderStage[] = [
    "ACCEPTED",
    "ARRIVED_PICKUP",
    "PICKED_UP",
    "ON_THE_WAY",
    "ARRIVED_DESTINATION",
  ];
  if (!allowedStages.includes(stage)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "stage must be one of the intermediate marketplace stages"
    );
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();
  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;
  if (deliveryData.orderKind !== "MARKETPLACE") {
    throw new functions.https.HttpsError("failed-precondition", "Not a marketplace delivery");
  }
  if (deliveryData.status !== "IN_PROGRESS") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Delivery is not in progress"
    );
  }

  await deliveryRef.update({
    adminOrderStage: stage,
    lastStageUpdatedAt: Date.now(),
    stageChangedByAdminId: adminId,
  });

  return {success: true, stage};
});

export const adminCancelMarketplaceDelivery = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId} = data;

  await verifyAdmin(adminId);

  if (!deliveryId) {
    throw new functions.https.HttpsError("invalid-argument", "deliveryId is required");
  }

  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();
  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;
  if (deliveryData.orderKind !== "MARKETPLACE") {
    throw new functions.https.HttpsError("failed-precondition", "Not a marketplace delivery");
  }

  await deliveryRef.update({
    status: "CANCELLED",
    adminOrderStage: "CANCELLED",
    endTime: Date.now(),
    cancelledByAdminId: adminId,
  });

  if (deliveryData.courierId) {
    await syncCourierStatus(deliveryData.courierId, "adminCancelMarketplaceDelivery: cancelled by admin");
  }

  return {success: true};
});

// ============ ADMIN: CREATE COURIER ============
export const createCourier = functions.https.onCall(async (data, context) => {
  const {login, password, name, surname, birthYear, city, phone, adminId,
    scooterPhotoUrl, passportFrontUrl, passportBackUrl} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!login || !password || !name) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "login, password, and name are required"
    );
  }

  // Check if login exists
  const existingUser = await db.collection("users")
    .where("login", "==", login)
    .get();

  if (!existingUser.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Login already exists"
    );
  }

  // Hash password
  const crypto = require("crypto");
  const passwordHash = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  // Create user
  const userRef = db.collection("users").doc();
  await userRef.set({
    login: login,
    passwordHash: passwordHash,
    passwordPlain: password,
    name: name,
    surname: surname || "",
    birthYear: birthYear || "",
    city: city || "",
    phone: phone || "",
    role: "COURIER",
    isOnline: false,
    isBlocked: false,
    balance: 0,
    createdAt: Date.now(),
    fcmToken: "",
    lastLocation: null,
    scooterPhotoUrl: scooterPhotoUrl || "",
    passportFrontUrl: passportFrontUrl || "",
    passportBackUrl: passportBackUrl || "",
  });

  return {
    userId: userRef.id,
    login: login,
    name: name,
  };
});

// ============ ADMIN: UPDATE TARIFF ============
export const updateTariff = functions.https.onCall(async (data, context) => {
  const {adminId, baseCost, baseDistanceKm, costPerKm, fixedTypes, heavyCargoMeter} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (baseCost === undefined || costPerKm === undefined) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "baseCost and costPerKm are required"
    );
  }

  await db.collection("tariffs").doc("default").set({
    baseCost: baseCost,
    baseDistanceKm: baseDistanceKm ?? 3,
    costPerKm: costPerKm,
    freeWaitingMinutes: data.freeWaitingMinutes ?? 5,
    costPerWaitingMinute: data.costPerWaitingMinute ?? 500,
    heavyCargoMeter: {
      baseCost: heavyCargoMeter?.baseCost ?? 15,
      baseDistanceKm: heavyCargoMeter?.baseDistanceKm ?? 3,
      costPerKm: heavyCargoMeter?.costPerKm ?? 4,
    },
    fixedTypes: fixedTypes || {
      coal: 0,
      gas15: 0,
      gas30: 0,
      gas30plus: 0,
      errands: 0,
      heavyCargo: 0,
    },
    currency: "сомони",
    isActive: true,
    updatedAt: Date.now(),
  }, {merge: true});

  return {success: true};
});

// ============ ADMIN: GET STATISTICS ============
export const getStatistics = functions.https.onCall(async (data, context) => {
  const {adminId, startDate, endDate} = data;

  // Verify admin
  await verifyAdmin(adminId);

  const start = startDate || (Date.now() - 86400000); // Default: last 24h
  const end = endDate || Date.now();

  // Get deliveries in range
  const deliveriesSnapshot = await db.collection("deliveries")
    .where("createdAt", ">=", start)
    .where("createdAt", "<=", end)
    .where("status", "==", "COMPLETED")
    .get();

  let totalRevenue = 0;
  let totalDistance = 0;
  const courierStats: {[key: string]: {count: number; revenue: number; name: string}} = {};

  deliveriesSnapshot.forEach((doc) => {
    const delivery = doc.data();
    totalRevenue += delivery.cost || 0;
    totalDistance += delivery.distanceMeters || 0;

    const cId = delivery.courierId;
    if (!courierStats[cId]) {
      courierStats[cId] = {count: 0, revenue: 0, name: delivery.courierName || ""};
    }
    courierStats[cId].count++;
    courierStats[cId].revenue += delivery.cost || 0;
  });

  // Get courier counts
  const allCouriers = await db.collection("users")
    .where("role", "==", "COURIER")
    .get();

  const activeCouriers = await db.collection("users")
    .where("role", "==", "COURIER")
    .where("isOnline", "==", true)
    .get();

  // Top couriers
  const topCouriers = Object.entries(courierStats)
    .map(([id, stats]) => ({id, ...stats}))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    totalDeliveries: deliveriesSnapshot.size,
    totalRevenue: totalRevenue,
    totalDistance: totalDistance,
    totalCouriers: allCouriers.size,
    activeCouriers: activeCouriers.size,
    topCouriers: topCouriers,
  };
});


// ============ ADMIN: UPDATE COMMISSION ============
export const updateCommission = functions.https.onCall(async (data, context) => {
  const {adminId, percent} = data;

  await verifyAdmin(adminId);

  if (percent === undefined || percent < 0 || percent > 100) {
    throw new functions.https.HttpsError("invalid-argument", "percent must be 0-100");
  }

  await db.collection("settings").doc("commission").set({
    percent: percent,
    updatedAt: Date.now(),
  }, {merge: true});

  return {success: true};
});

// ============ ADMIN: TOP UP COURIER BALANCE ============
export const topUpBalance = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, amount, note} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!courierId || !amount || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "courierId and positive amount required");
  }

  // Get courier
  const courierRef = db.collection("users").doc(courierId);
  const courierDoc = await courierRef.get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  const currentBalance = courierData.balance || 0;
  const newBalance = currentBalance + amount;

  // Update balance
  await courierRef.update({balance: newBalance});

  // Record transaction
  const txRef = await db.collection("transactions").add({
    courierId: courierId,
    courierName: courierData.name || "",
    type: "TOP_UP",
    amount: amount,
    balanceAfter: newBalance,
    description: note || "Пополнение баланса",
    adminId: adminId,
    createdAt: Date.now(),
  });

  await sendPushToCourier(courierData, {
    title: "Баланс пополнен",
    body: `+${amount} сомони. Новый баланс: ${newBalance} сомони`,
    data: {
      type: "BALANCE_TOP_UP",
      amount: String(amount),
      newBalance: String(newBalance),
    },
  });

  return {
    success: true,
    newBalance: newBalance,
    transactionId: txRef.id,
  };
});

// ============ GET COURIER TRANSACTIONS ============
export const getCourierTransactions = functions.https.onCall(async (data, context) => {
  const {courierId, limit: queryLimit} = data;

  if (!courierId) {
    throw new functions.https.HttpsError("invalid-argument", "courierId required");
  }

  const snapshot = await db.collection("transactions")
    .where("courierId", "==", courierId)
    .orderBy("createdAt", "desc")
    .limit(queryLimit || 50)
    .get();

  const transactions = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return {transactions};
});


// ============ ADMIN: REQUEST COURIER LOCATION ============
// Sends an FCM data-only message to the courier's device.
// The app handles it in the background and updates lastLocation in Firestore.
export const requestCourierLocation = functions.https.onCall(async (data, context) => {
  const {adminId, courierId} = data;

  // Verify admin (allow SUPER_ADMIN or regular ADMIN)
  await verifyAdmin(adminId);

  if (!courierId) {
    throw new functions.https.HttpsError("invalid-argument", "courierId required");
  }

  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  const fcmToken = courierData.fcmToken;
  const lastLocation = courierData.lastLocation;

  // If no FCM token, return the last known location if available
  if (!fcmToken) {
    if (lastLocation && lastLocation.timestamp) {
      const locationAge = Date.now() - lastLocation.timestamp;
      const minutesAgo = Math.floor(locationAge / 60000);
      
      return {
        success: true,
        message: `Последняя локация получена ${minutesAgo} минут назад. FCM токен отсутствует - курьер должен открыть приложение.`,
        hasToken: false,
        lastLocation: lastLocation,
      };
    } else {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "У курьера нет FCM токена и нет данных о местоположении. Курьер должен хотя бы раз открыть приложение."
      );
    }
  }

  // Try to send FCM request
  try {
    await admin.messaging().send({
      token: fcmToken,
      data: {
        type: "REQUEST_LOCATION",
        requestedAt: String(Date.now()),
      },
      android: {
        priority: "high",
      },
    });
    
    return {
      success: true,
      message: "Запрос отправлен. Местоположение обновится через несколько секунд.",
      hasToken: true,
    };
  } catch (e: any) {
    // FCM token might be invalid/expired
    console.error("FCM send error:", e);
    
    // Return last location if available
    if (lastLocation && lastLocation.timestamp) {
      const locationAge = Date.now() - lastLocation.timestamp;
      const minutesAgo = Math.floor(locationAge / 60000);
      
      return {
        success: true,
        message: `FCM токен недействителен. Показана последняя локация (${minutesAgo} минут назад). Курьер должен переоткрыть приложение.`,
        hasToken: false,
        lastLocation: lastLocation,
      };
    }
    
    throw new functions.https.HttpsError(
      "unavailable",
      "Не удалось отправить запрос на устройство курьера. FCM токен недействителен."
    );
  }
});


// ============ ADMIN: UPDATE COURIER COMMISSION ============
// Sets an individual commission percentage for a specific courier.
// If set, it overrides the global commission from settings/commission.
export const updateCourierCommission = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, percent} = data;

  await verifyAdmin(adminId);

  if (!courierId) {
    throw new functions.https.HttpsError("invalid-argument", "courierId required");
  }

  if (percent === undefined || percent < 0 || percent > 100) {
    throw new functions.https.HttpsError("invalid-argument", "percent must be 0-100");
  }

  const courierRef = db.collection("users").doc(courierId);
  const courierDoc = await courierRef.get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  await courierRef.update({
    commissionPercent: percent,
  });

  return {success: true, courierId, percent};
});


// ============ ADMIN: UPDATE COURIER CREDENTIALS ============
export const updateCourierCredentials = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, login, password} = data;

  await verifyAdmin(adminId);

  if (!courierId) {
    throw new functions.https.HttpsError("invalid-argument", "courierId required");
  }

  const courierRef = db.collection("users").doc(courierId);
  const courierDoc = await courierRef.get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const updates: {[key: string]: string} = {};

  // Update login if provided
  if (login && login !== courierDoc.data()!.login) {
    // Check if new login already exists
    const existing = await db.collection("users")
      .where("login", "==", login)
      .get();
    if (!existing.empty) {
      throw new functions.https.HttpsError("already-exists", "Логин уже занят");
    }
    updates.login = login;
  }

  // Update password if provided
  if (password) {
    const crypto = require("crypto");
    updates.passwordHash = crypto
      .createHash("sha256")
      .update(password)
      .digest("hex");
    // Store plain password for admin visibility
    updates.passwordPlain = password;
  }

  if (Object.keys(updates).length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "Нечего обновлять");
  }

  await courierRef.update(updates);

  return {success: true};
});

// ============ ADMIN: ASSIGN COURIER TO CLIENT ============
export const assignCourierToClient = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, clientPhone} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!courierId || !clientPhone) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "courierId and clientPhone are required"
    );
  }

  // Get courier info
  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;

  // Check if courier is blocked
  if (courierData.isBlocked) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Курьер заблокирован"
    );
  }

  // Build SMS message in Tajik
  const courierName = courierData.name || "";
  const courierPhone = courierData.phone || "";
  
  let smsText = `Расонандаи мо ${courierName}`;
  
  if (courierPhone) {
    smsText += ` (тел: ${courierPhone})`;
  }
  
  smsText += ` барои шумо таъин карда шуд. `;
  smsText += `Барои фармоиш додан бо ӯ тамос гиред. `;
  smsText += `Барои даъвати расонанда телеграм бот: https://t.me/zakidostavka_bot`;

  // Send SMS to client
  await sendSms(clientPhone, smsText);

  // Log the assignment
  await db.collection("courierAssignments").add({
    adminId: adminId,
    courierId: courierId,
    courierName: courierName,
    clientPhone: clientPhone,
    createdAt: Date.now(),
  });

  return {
    success: true,
    courierName: courierName,
    clientPhone: clientPhone,
  };
});


// ============ DELIVERY CHAINS ============

// Start delivery chain (called by courier app)
export const startDeliveryChain = functions.https.onCall(async (data, context) => {
  const {chainId, courierId, items} = data;

  if (!chainId || !courierId || !items || items.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "chainId, courierId, and items are required"
    );
  }

  // Verify courier
  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  if (courierData.isBlocked) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Courier is blocked"
    );
  }

  // Check balance
  const courierBalance = courierData.balance || 0;
  if (courierBalance < 5) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Недостаточно средств на балансе. Минимум 5 сомони для начала доставки."
    );
  }

  // Check for active delivery or chain
  const activeDeliveries = await db.collection("deliveries")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  if (!activeDeliveries.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Courier already has an active delivery"
    );
  }

  const activeChains = await db.collection("delivery_chains")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  if (!activeChains.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Courier already has an active chain"
    );
  }

    // Create chain in Firestore
  await db.collection("delivery_chains").doc(chainId).set({
    courierId: courierId,
    courierName: courierData.name || "",
    status: "IN_PROGRESS",
    createdAt: Date.now(),
    startedAt: Date.now(),
    totalDistance: 0,
    totalCost: 0,
  });

  // Create chain items
  const batch = db.batch();
  for (const item of items) {
    const itemRef = db.collection("chain_delivery_items").doc(item.id);
    batch.set(itemRef, {
      chainId: chainId,
      clientPhone: item.clientPhone,
      orderNumber: item.orderNumber,
      sequenceOrder: item.sequenceOrder,
      status: item.sequenceOrder === 1 ? "IN_PROGRESS" : "PENDING",
      deliveryType: item.deliveryType || "default",
      createdAt: Date.now(),
    });
  }
  await batch.commit();

  // ---- Sync courier status: chain IN_PROGRESS → courier must be ONLINE ----
  await syncCourierStatus(courierId, "startDeliveryChain: chain set to IN_PROGRESS");

  // Send SMS to first customer
  const firstItem = items.find((item: any) => item.sequenceOrder === 1);
  if (firstItem) {
    const courierName = courierData.name || "";
    const courierPhone = courierData.phone || "";
    
    let startSmsText = `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. `;
    startSmsText += `Расонанда: ${courierName}`;
    
    if (courierPhone) {
      startSmsText += `, тел: ${courierPhone}`;
    }
    
    startSmsText += `. Рақами фармоиш: ${firstItem.orderNumber}`;

    await sendSms(firstItem.clientPhone, startSmsText);
  }

  return {success: true, chainId: chainId};
});

// Complete current item in chain and move to next
export const completeChainDelivery = functions.https.onCall(async (data, context) => {
  const {chainId, itemId, route, waitingMinutes, endTime} = data;

  if (!chainId || !itemId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "chainId and itemId are required"
    );
  }

  // Get chain
  const chainRef = db.collection("delivery_chains").doc(chainId);
  const chainDoc = await chainRef.get();
  
  if (!chainDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Chain not found");
  }

  const chainData = chainDoc.data()!;
  if (chainData.status !== "IN_PROGRESS") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Chain is not in progress"
    );
  }

  // Get item
  const itemRef = db.collection("chain_delivery_items").doc(itemId);
  const itemDoc = await itemRef.get();
  
  if (!itemDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Item not found");
  }

  const itemData = itemDoc.data()!;
  if (itemData.status !== "IN_PROGRESS") {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Item is not in progress"
    );
  }

  // Calculate cost
  const deliveryType = itemData.deliveryType || "default";
  const fixedPrice = itemData.fixedPrice;
  
  let totalCost: number;
  let distanceMeters = 0;
  let waitingCost = 0;
  
  if (deliveryType !== "default" && fixedPrice !== null && fixedPrice !== undefined) {
    // Fixed price
    totalCost = fixedPrice;
  } else {
    // Calculate from route
    const routePoints = route || [];
    distanceMeters = calculateRouteDistance(routePoints);

    const tariffDoc = await db.collection("tariffs").doc("default").get();
    let baseCost = 5000;
    let baseDistanceKm = 3;
    let costPerKm = 1500;

    if (tariffDoc.exists) {
      const tariffData = tariffDoc.data()!;
      baseCost = tariffData.baseCost || 5000;
      baseDistanceKm = tariffData.baseDistanceKm ?? 3;
      costPerKm = tariffData.costPerKm || 1500;
    }

    const roundedCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);

    const freeWaitingMinutes = tariffDoc.exists
      ? (tariffDoc.data()!.freeWaitingMinutes ?? 5)
      : 5;
    const costPerWaitingMinute = tariffDoc.exists
      ? (tariffDoc.data()!.costPerWaitingMinute ?? 500)
      : 500;

    const actualWaitingMinutes = waitingMinutes || 0;
    if (actualWaitingMinutes > freeWaitingMinutes) {
      waitingCost = Math.round((actualWaitingMinutes - freeWaitingMinutes) * costPerWaitingMinute * 100) / 100;
    }

    totalCost = roundedCost + waitingCost;
  }

  // Calculate commission
  const courierRef = db.collection("users").doc(chainData.courierId);
  const courierDoc = await courierRef.get();
  const courierData = courierDoc.exists ? courierDoc.data()! : {};

  let commissionPercent: number;
  if (courierData.commissionPercent !== undefined && courierData.commissionPercent !== null) {
    commissionPercent = courierData.commissionPercent;
  } else {
    const settingsDoc = await db.collection("settings").doc("commission").get();
    commissionPercent = settingsDoc.exists ? (settingsDoc.data()!.percent || 0) : 0;
  }
  // Exact commission — no rounding, preserve dirams for transparency
  const commissionAmount = Math.round((totalCost * commissionPercent / 100) * 100) / 100;

  // Deduct commission
  const currentBalance = courierData.balance || 0;
  const newBalance = currentBalance - commissionAmount;
  await courierRef.update({balance: newBalance});

  // Record transaction
  if (commissionAmount > 0) {
    await db.collection("transactions").add({
      courierId: chainData.courierId,
      courierName: chainData.courierName || "",
      type: "COMMISSION",
      amount: -commissionAmount,
      chainId: chainId,
      itemId: itemId,
      balanceAfter: newBalance,
      description: `Комиссия ${commissionPercent}% за доставку в цепочке`,
      createdAt: Date.now(),
    });
  }

  // Update item
  await itemRef.update({
    status: "COMPLETED",
    endTime: endTime || Date.now(),
    distanceMeters: distanceMeters,
    cost: totalCost,
    waitingMinutes: waitingMinutes || 0,
    waitingCost: waitingCost,
    commission: commissionAmount,
  });

  // Send completion SMS to current customer
  let completeSmsText = `Фармоиши ZaKi анҷом ёфт. `;
  completeSmsText += `Рақами фармоиш: ${itemData.orderNumber}. `;
  
  if (deliveryType !== "default" && fixedPrice) {
    completeSmsText += `Навъи хидмат: ${deliveryType}. `;
  } else {
    const distanceKmText = (distanceMeters / 1000).toFixed(1);
    completeSmsText += `Масофа: ${distanceKmText} км. `;
    
    if (waitingCost > 0) {
      const waitingMinsRounded = Math.ceil(waitingMinutes || 0);
      completeSmsText += `Интизорӣ: ${waitingMinsRounded} дақ. (${formatCostForSms(waitingCost)} сомонӣ). `;
    }
  }

  completeSmsText += `Маблағи умумӣ: ${formatCostForSms(totalCost)} сомонӣ. Ташаккур!`;
  await sendSms(itemData.clientPhone, completeSmsText);

  // Check for next item
  const allItems = await db.collection("chain_delivery_items")
    .where("chainId", "==", chainId)
    .orderBy("sequenceOrder", "asc")
    .get();

  const nextItem = allItems.docs.find(doc => 
    doc.data().status === "PENDING"
  );

  if (nextItem) {
    // Start next item
    await nextItem.ref.update({
      status: "IN_PROGRESS",
      startTime: Date.now(),
    });

    // Send SMS to next customer
    const nextData = nextItem.data();
    const courierName = chainData.courierName || "";
    const courierPhone = courierData.phone || "";
    
    let startSmsText = `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. `;
    startSmsText += `Расонанда: ${courierName}`;
    
    if (courierPhone) {
      startSmsText += `, тел: ${courierPhone}`;
    }
    
    startSmsText += `. Рақами фармоиш: ${nextData.orderNumber}`;
    await sendSms(nextData.clientPhone, startSmsText);
  } else {
    // All items completed - complete chain
    const completedItems = allItems.docs.filter(doc => 
      doc.data().status === "COMPLETED"
    );
    
    const totalDistance = completedItems.reduce((sum, doc) => 
      sum + (doc.data().distanceMeters || 0), 0
    );
    const totalChainCost = completedItems.reduce((sum, doc) => 
      sum + (doc.data().cost || 0), 0
    );

        await chainRef.update({
      status: "COMPLETED",
      completedAt: Date.now(),
      totalDistance: totalDistance,
      totalCost: totalChainCost,
    });
  }

  // ---- Sync courier status after chain item completion ----
  // If chain completed → isOnline might become false
  // If chain still in progress (next item exists) → isOnline should stay true
  await syncCourierStatus(chainData.courierId, "completeChainDelivery: chain item completed");

  return {
    success: true,
    cost: totalCost,
    distanceMeters: distanceMeters,
    hasNext: !!nextItem,
  };
});

// Cancel delivery chain
export const cancelDeliveryChain = functions.https.onCall(async (data, context) => {
  const {chainId, courierId} = data;

  if (!chainId || !courierId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "chainId and courierId are required"
    );
  }

  const chainRef = db.collection("delivery_chains").doc(chainId);
  const chainDoc = await chainRef.get();
  
  if (!chainDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Chain not found");
  }

  const chainData = chainDoc.data()!;
  if (chainData.courierId !== courierId) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Not authorized"
    );
  }

  // Update chain
  await chainRef.update({
    status: "CANCELLED",
    completedAt: Date.now(),
  });

    // Cancel all pending items
  const items = await db.collection("chain_delivery_items")
    .where("chainId", "==", chainId)
    .where("status", "in", ["PENDING", "IN_PROGRESS"])
    .get();

  const batch = db.batch();
  items.docs.forEach(doc => {
    batch.update(doc.ref, {status: "CANCELLED"});
  });
  await batch.commit();

  // ---- Sync courier status after chain cancellation ----
  await syncCourierStatus(courierId, "cancelDeliveryChain: chain cancelled");

  return {success: true};
});

// Admin: Create and assign delivery chain to courier
export const adminCreateDeliveryChain = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, items} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!courierId || !items || items.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "courierId and items are required"
    );
  }

  // Verify courier
  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  if (courierData.isBlocked) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Courier is blocked"
    );
  }

  // Check balance
  const courierBalance = courierData.balance || 0;
  if (courierBalance < 5) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Недостаточно средств на балансе курьера. Минимум 5 сомони."
    );
  }

  // Check for active delivery or chain
  const activeDeliveries = await db.collection("deliveries")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  if (!activeDeliveries.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Courier already has an active delivery"
    );
  }

  const activeChains = await db.collection("delivery_chains")
    .where("courierId", "==", courierId)
    .where("status", "==", "IN_PROGRESS")
    .get();

  if (!activeChains.empty) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Courier already has an active chain"
    );
  }

    // Create chain
  const chainRef = db.collection("delivery_chains").doc();
  await chainRef.set({
    courierId: courierId,
    courierName: courierData.name || "",
    status: "IN_PROGRESS",
    createdAt: Date.now(),
    startedAt: Date.now(),
    totalDistance: 0,
    totalCost: 0,
  });

  // Create chain items
  const batch = db.batch();
  items.forEach((item: any, index: number) => {
    const itemRef = db.collection("chain_delivery_items").doc();
    batch.set(itemRef, {
      chainId: chainRef.id,
      clientPhone: item.clientPhone,
      orderNumber: item.orderNumber,
      sequenceOrder: index + 1,
      status: index === 0 ? "IN_PROGRESS" : "PENDING",
      deliveryType: item.deliveryType || "default",
      createdAt: Date.now(),
    });
  });
  await batch.commit();

  // ---- Sync courier status: admin-created chain IN_PROGRESS → courier must be ONLINE ----
  await syncCourierStatus(courierId, "adminCreateDeliveryChain: admin created chain with IN_PROGRESS status");

  // Send SMS to first customer
  const firstItem = items[0];
  if (firstItem) {
    const courierName = courierData.name || "";
    const courierPhone = courierData.phone || "";
    
    let startSmsText = `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. `;
    startSmsText += `Расонанда: ${courierName}`;
    
    if (courierPhone) {
      startSmsText += `, тел: ${courierPhone}`;
    }
    
    startSmsText += `. Рақами фармоиш: ${firstItem.orderNumber}`;
    await sendSms(firstItem.clientPhone, startSmsText);
  }

  await sendPushToCourier(courierData, {
    title: "Новая цепочка заказов",
    body: `Вам назначена цепочка из ${items.length} заказов`,
    data: {
      type: "NEW_CHAIN",
      chainId: chainRef.id,
    },
  });

  return {success: true, chainId: chainRef.id};
});

// Admin: Cancel delivery chain
export const adminCancelDeliveryChain = functions.https.onCall(async (data, context) => {
  const {adminId, chainId} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!chainId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "chainId is required"
    );
  }

  const chainRef = db.collection("delivery_chains").doc(chainId);
  const chainDoc = await chainRef.get();
  
  if (!chainDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Chain not found");
  }

    // Update chain
  await chainRef.update({
    status: "CANCELLED",
    completedAt: Date.now(),
  });

  // Cancel all pending items
  const items = await db.collection("chain_delivery_items")
    .where("chainId", "==", chainId)
    .where("status", "in", ["PENDING", "IN_PROGRESS"])
    .get();

  const batch = db.batch();
  items.docs.forEach(doc => {
    batch.update(doc.ref, {status: "CANCELLED"});
  });
  await batch.commit();

  // Get the chain data to find the courierId
  const chainDataForStatus = chainDoc.data()!;
  // ---- Sync courier status after admin chain cancellation ----
  await syncCourierStatus(chainDataForStatus.courierId, "adminCancelDeliveryChain: chain cancelled by admin");

  return {success: true};
});

// Admin: Complete delivery (for problem deliveries)
export const adminCompleteDelivery = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId} = data;

  // Verify admin
  await verifyAdmin(adminId);

  if (!deliveryId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId is required"
    );
  }

  // Get delivery
  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();

  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;

  const isMarketplacePending = deliveryData.orderKind === "MARKETPLACE" && deliveryData.status === "PENDING";
  if (deliveryData.status !== "IN_PROGRESS" && !isMarketplacePending) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Delivery is not in progress"
    );
  }

  // Use existing route or empty
  const route = deliveryData.route || [];
  const distanceMeters = route.length > 0 ? calculateRouteDistance(route) : 0;

  // Check if fixed price
  const deliveryType = deliveryData.deliveryType || "default";
  const fixedPrice = deliveryData.fixedPrice;
  
  let totalCost: number;
  
  if (deliveryType !== "default" && fixedPrice !== null && fixedPrice !== undefined) {
    totalCost = fixedPrice;
  } else {
    // Calculate cost
    const tariffDoc = await db.collection("tariffs").doc("default").get();
    let baseCost = 5000;
    let baseDistanceKm = 3;
    let costPerKm = 1500;

    if (tariffDoc.exists) {
      const tariffData = tariffDoc.data()!;
      baseCost = tariffData.baseCost || 5000;
      baseDistanceKm = tariffData.baseDistanceKm ?? 3;
      costPerKm = tariffData.costPerKm || 1500;
    }

    totalCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);
  }

  // Calculate commission
  const courierRef = db.collection("users").doc(deliveryData.courierId);
  const courierDoc = await courierRef.get();
  const courierData = courierDoc.exists ? courierDoc.data()! : {};

  let commissionPercent: number;
  if (courierData.commissionPercent !== undefined && courierData.commissionPercent !== null) {
    commissionPercent = courierData.commissionPercent;
  } else {
    const settingsDoc = await db.collection("settings").doc("commission").get();
    commissionPercent = settingsDoc.exists ? (settingsDoc.data()!.percent || 0) : 0;
  }
  // Exact commission — no rounding, preserve dirams for transparency
  const commissionAmount = Math.round((totalCost * commissionPercent / 100) * 100) / 100;

  // Deduct commission
  const currentBalance = courierData.balance || 0;
  const newBalance = currentBalance - commissionAmount;
  await courierRef.update({balance: newBalance});

  // Record transaction
  if (commissionAmount > 0) {
    await db.collection("transactions").add({
      courierId: deliveryData.courierId,
      courierName: deliveryData.courierName || "",
      type: "COMMISSION",
      amount: -commissionAmount,
      deliveryId: deliveryId,
      balanceAfter: newBalance,
      description: `Комиссия ${commissionPercent}% за доставку (завершена админом)`,
      createdAt: Date.now(),
    });
  }

  // Update delivery
  await deliveryRef.update({
    status: "COMPLETED",
    endTime: Date.now(),
    distanceMeters: distanceMeters,
    cost: totalCost,
    waitingMinutes: 0,
    waitingCost: 0,
    commission: commissionAmount,
  });

  // Send SMS to client
  let completeSmsText = `Фармоиши ZaKi анҷом ёфт. `;
  
  if (deliveryType !== "default" && fixedPrice) {
    completeSmsText += `Навъи хидмат: ${deliveryType}. `;
  } else if (distanceMeters > 0) {
    const distanceKmText = (distanceMeters / 1000).toFixed(1);
    completeSmsText += `Масофа: ${distanceKmText} км. `;
  }

    completeSmsText += `Маблағи умумӣ: ${formatCostForSms(totalCost)} сомонӣ. Ташаккур!`;
  await sendSms(deliveryData.clientPhone, completeSmsText);

  // ---- Sync courier status after admin completes the delivery ----
  await syncCourierStatus(deliveryData.courierId, "adminCompleteDelivery: delivery completed by admin");

  return {success: true};
});

// ============ ADMIN: SET DELIVERY STATUS (COMPLETED <-> CANCELLED anytime) ============
// Allows an admin to switch a delivery between COMPLETED and CANCELLED at any
// time. Commission is charged/refunded idempotently so the courier balance
// stays correct no matter how many times the status is toggled.
export const adminSetDeliveryStatus = functions.https.onCall(async (data, context) => {
  const {adminId, deliveryId} = data;
  const newStatus: string = data.status;

  console.log("[adminSetDeliveryStatus] called", {adminId, deliveryId, newStatus});

  await verifyAdmin(adminId);

  if (!deliveryId || !newStatus) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "deliveryId and status are required"
    );
  }
  if (newStatus !== "COMPLETED" && newStatus !== "CANCELLED") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "status must be COMPLETED or CANCELLED"
    );
  }

  try {
  const deliveryRef = db.collection("deliveries").doc(deliveryId);
  const deliveryDoc = await deliveryRef.get();
  if (!deliveryDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Delivery not found");
  }

  const deliveryData = deliveryDoc.data()!;
  const currentStatus = deliveryData.status;
  const courierId: string | null = deliveryData.courierId || null;
  const isMarketplace = deliveryData.orderKind === "MARKETPLACE";

  // Nothing to do if already in the requested status.
  if (currentStatus === newStatus) {
    return {success: true, unchanged: true, status: newStatus};
  }

  // Is the commission currently deducted from the courier balance?
  // Legacy fallback: a COMPLETED delivery with commission>0 counts as charged.
  const commissionCurrentlyCharged =
    deliveryData.commissionCharged === true ||
    (deliveryData.commissionCharged === undefined &&
      currentStatus === "COMPLETED" &&
      (deliveryData.commission || 0) > 0);

  if (newStatus === "COMPLETED") {
    // ---- Determine cost ----
    let totalCost: number;
    let distanceMeters: number = deliveryData.distanceMeters || 0;
    const deliveryType = deliveryData.deliveryType || "default";
    const fixedPrice = deliveryData.fixedPrice;

    if ((deliveryData.cost || 0) > 0) {
      // Reuse cost computed previously (e.g. re-completing after a cancel).
      totalCost = deliveryData.cost;
    } else if (
      deliveryType !== "default" &&
      deliveryType !== "heavyCargoMeter" &&
      fixedPrice !== null &&
      fixedPrice !== undefined
    ) {
      // Fixed-price service type — always the fixed price.
      totalCost = fixedPrice;
    } else if ((deliveryData.liveCost || 0) > 0) {
      // Metered delivery: use the courier's LIVE meter amount (exactly what the
      // courier sees running, e.g. 16.30), not a recomputed base price.
      totalCost = deliveryData.liveCost;
      distanceMeters = deliveryData.distanceMeters || distanceMeters;
    } else {
      // Fallback: reconstruct cost from the synced route / distance and tariff.
      const route = deliveryData.route || [];
      distanceMeters = route.length > 0 ? calculateRouteDistance(route) : distanceMeters;
      const tariffDoc = await db.collection("tariffs").doc("default").get();
      let baseCost = 5000;
      let baseDistanceKm = 3;
      let costPerKm = 1500;
      if (tariffDoc.exists) {
        const t = tariffDoc.data()!;
        if (deliveryType === "heavyCargoMeter") {
          const hcm = t.heavyCargoMeter || {};
          baseCost = hcm.baseCost ?? 15;
          baseDistanceKm = hcm.baseDistanceKm ?? 3;
          costPerKm = hcm.costPerKm ?? 4;
        } else {
          baseCost = t.baseCost || 5000;
          baseDistanceKm = t.baseDistanceKm ?? 3;
          costPerKm = t.costPerKm || 1500;
        }
      }
      totalCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);
    }

    // ---- Determine and (if needed) charge commission ----
    let commissionAmount = deliveryData.commission || 0;
    if (courierId) {
      const courierRef = db.collection("users").doc(courierId);
      const courierDoc = await courierRef.get();
      const courierData = courierDoc.exists ? courierDoc.data()! : {};

      if (!(commissionAmount > 0)) {
        let commissionPercent: number;
        if (
          courierData.commissionPercent !== undefined &&
          courierData.commissionPercent !== null
        ) {
          commissionPercent = courierData.commissionPercent;
        } else {
          const settingsDoc = await db.collection("settings").doc("commission").get();
          commissionPercent = settingsDoc.exists ? (settingsDoc.data()!.percent || 0) : 0;
        }
        commissionAmount = Math.round((totalCost * commissionPercent / 100) * 100) / 100;
      }

      if (!commissionCurrentlyCharged && commissionAmount > 0) {
        const currentBalance = courierData.balance || 0;
        const newBalance = currentBalance - commissionAmount;
        await courierRef.update({balance: newBalance});
        await db.collection("transactions").add({
          courierId: courierId,
          courierName: deliveryData.courierName || "",
          type: "COMMISSION",
          amount: -commissionAmount,
          deliveryId: deliveryId,
          balanceAfter: newBalance,
          description: "Комиссия за доставку (завершена админом)",
          createdAt: Date.now(),
        });
      }
    }

    const update: {[key: string]: unknown} = {
      status: "COMPLETED",
      endTime: Date.now(),
      distanceMeters: distanceMeters,
      cost: totalCost,
      commission: commissionAmount,
      commissionCharged: !!courierId && commissionAmount > 0,
      statusChangedByAdminId: adminId,
      statusChangedAt: Date.now(),
    };
    if (isMarketplace) update.adminOrderStage = "COMPLETED";
    await deliveryRef.update(update);

    // Notify client only when transitioning into COMPLETED.
    if (deliveryData.clientPhone) {
      let smsText = "Фармоиши ZaKi анҷом ёфт. ";
      if (distanceMeters > 0) {
        smsText += `Масофа: ${(distanceMeters / 1000).toFixed(1)} км. `;
      }
      smsText += `Маблағи умумӣ: ${formatCostForSms(totalCost)} сомонӣ. Ташаккур!`;
      await sendSms(deliveryData.clientPhone, smsText);
    }

    if (courierId) {
      await syncCourierStatus(courierId, "adminSetDeliveryStatus: status -> COMPLETED");
    }

    return {success: true, status: "COMPLETED"};
  }

  // ---- newStatus === "CANCELLED" ----
  // Refund the commission if it is currently charged to the courier.
  if (courierId && commissionCurrentlyCharged) {
    const commissionAmount = deliveryData.commission || 0;
    if (commissionAmount > 0) {
      const courierRef = db.collection("users").doc(courierId);
      const courierDoc = await courierRef.get();
      const courierData = courierDoc.exists ? courierDoc.data()! : {};
      const currentBalance = courierData.balance || 0;
      const newBalance = currentBalance + commissionAmount;
      await courierRef.update({balance: newBalance});
      await db.collection("transactions").add({
        courierId: courierId,
        courierName: deliveryData.courierName || "",
        type: "COMMISSION_REFUND",
        amount: commissionAmount,
        deliveryId: deliveryId,
        balanceAfter: newBalance,
        description: "Возврат комиссии (доставка отменена админом)",
        createdAt: Date.now(),
      });
    }
  }

  const cancelUpdate: {[key: string]: unknown} = {
    status: "CANCELLED",
    endTime: Date.now(),
    commissionCharged: false,
    cancelledByAdminId: adminId,
    statusChangedByAdminId: adminId,
    statusChangedAt: Date.now(),
  };
  if (isMarketplace) cancelUpdate.adminOrderStage = "CANCELLED";
  await deliveryRef.update(cancelUpdate);

  if (courierId) {
    await syncCourierStatus(courierId, "adminSetDeliveryStatus: status -> CANCELLED");
  }

  return {success: true, status: "CANCELLED"};
  } catch (err: any) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error("[adminSetDeliveryStatus] failed:", err);
    throw new functions.https.HttpsError(
      "internal",
      `Не удалось изменить статус: ${err?.message || String(err)}`
    );
  }
});


// ============ TELEGRAM REPORT ============

const TELEGRAM_BOT_TOKEN = "8620521976:AAHw9ySmHH63NPrmOH4aC9RMyvuLTWJXu00";
const TELEGRAM_CHAT_ID = "-5440589956";

async function buildDailyReportText(): Promise<string> {
  const now = new Date();
  // Use UTC+5 (Tajikistan) for start-of-day calculation
  const tjOffsetMs = 5 * 60 * 60 * 1000;
  const nowTj = new Date(now.getTime() + tjOffsetMs);
  const startOfDayTj = new Date(
    Date.UTC(nowTj.getUTCFullYear(), nowTj.getUTCMonth(), nowTj.getUTCDate())
  ).getTime() - tjOffsetMs;
  const endOfDayTj = now.getTime();

  // Query only by endTime range to avoid composite index requirement;
  // filter status in code.
  const snapshot = await db.collection("deliveries")
    .where("endTime", ">=", startOfDayTj)
    .where("endTime", "<=", endOfDayTj)
    .get();

  const courierMap: {[id: string]: {name: string; count: number; commission: number}} = {};
  let totalCommission = 0;
  let totalOrders = 0;

  snapshot.forEach((doc) => {
    const d = doc.data();
    if (d.status !== "COMPLETED") return;
    totalOrders++;
    const cid = d.courierId || "unknown";
    if (!courierMap[cid]) {
      courierMap[cid] = {name: d.courierName || cid, count: 0, commission: 0};
    }
    courierMap[cid].count++;
    const comm = d.commission || 0;
    courierMap[cid].commission += comm;
    totalCommission += comm;
  });

  const dateStr = nowTj.toLocaleDateString("ru-RU", {day: "2-digit", month: "2-digit", year: "numeric"});

  let text = `📊 *Ежедневный отчёт ZaKi*\n`;
  text += `📅 ${dateStr}\n\n`;

  if (totalOrders === 0) {
    text += `Заказов за сегодня нет.\n`;
  } else {
    text += `*Курьеры:*\n`;
    const sorted = Object.values(courierMap).sort((a, b) => b.count - a.count);
    sorted.forEach((c, i) => {
      text += `${i + 1}. ${c.name} — ${c.count} заказ(ов)\n`;
    });
    text += `\n✅ *Итого заказов: ${totalOrders}*`;
    text += `\n💰 *Итого комиссия: ${totalCommission.toLocaleString("ru-RU")} сомони*`;
  }

  return text;
}

async function sendTelegramMessage(text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    console.error(`Telegram send failed (${response.status}): ${err}`);
    throw new Error(`Telegram API error ${response.status}: ${err}`);
  }

  const result: any = await response.json().catch(() => ({}));
  console.log("Telegram message sent, message_id=", result?.result?.message_id);
}

// Callable: send report immediately (triggered by admin button)
export const sendTelegramReport = functions.https.onCall(async (data, context) => {
  const {adminId} = data;
  await verifyAdmin(adminId);

  try {
    const text = await buildDailyReportText();
    await sendTelegramMessage(text);
  } catch (e: any) {
    console.error("sendTelegramReport error:", e);
    throw new functions.https.HttpsError(
      "internal",
      "Ошибка отправки в Telegram: " + (e?.message || String(e))
    );
  }

  return {success: true};
});

// Scheduled: send report every day at the time stored in settings/telegramReport
export const scheduledTelegramReport = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    const settingsSnap = await db.collection("settings").doc("telegramReport").get();
    if (!settingsSnap.exists) return null;

    const settings = settingsSnap.data()!;
    if (!settings.enabled) return null;

    const targetHour: number = settings.hour ?? 23;
    const targetMinute: number = settings.minute ?? 0;

    const now = new Date();
    // Use UTC+5 (Tajikistan time) by offsetting
    const tjOffset = 5 * 60;
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const tjMinutes = (utcMinutes + tjOffset) % (24 * 60);
    const tjHour = Math.floor(tjMinutes / 60);
    const tjMin = tjMinutes % 60;

    if (tjHour !== targetHour || tjMin !== targetMinute) return null;

    // Deduplicate: record last sent date so we don't send twice in the same minute
    const todayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${targetHour}-${targetMinute}`;
    const lastSent = settings.lastSentKey;
    if (lastSent === todayKey) {
      console.log("Telegram report already sent for this time slot today.");
      return null;
    }

    const text = await buildDailyReportText();
    await sendTelegramMessage(text);

    await db.collection("settings").doc("telegramReport").update({
      lastSentKey: todayKey,
      lastSentAt: Date.now(),
    });

    console.log("Scheduled Telegram report sent successfully.");
    return null;
  });

// ============ TAXI MODULE ============
// Keep taxi logic fully isolated in taxi.ts and taxiDrivers.ts.
export { createTaxiOrder, taxiTelegramPoller } from "./taxi";
export { approveTaxiDriver, rejectTaxiDriver, blockTaxiDriver, sendTaxiBroadcast, createTaxiDriverByAdmin } from "./taxiDrivers";


// ============ ONE-TIME MIGRATION: push all historical commissions to ZaKi Rashod ============
// Call this once via HTTP: GET https://<region>-auva-70253.cloudfunctions.net/migrateCommissionsToRashod
// After successful migration, delete this function.
export const migrateCommissionsToRashod = functions.runWith({ timeoutSeconds: 540, memory: "512MB" }).https.onRequest(async (req, res) => {
  const ZAKI_URL = process.env.ZAKI_RASHOD_COMMISSION_URL || "";
  const ZAKI_KEY = process.env.ZAKI_RASHOD_API_KEY || "";

  if (!ZAKI_URL) {
    res.status(500).json({ error: "ZAKI_RASHOD_COMMISSION_URL not configured" });
    return;
  }

  try {
    // Step 1: Delete ALL existing taksometr records from rashod_commissions
    // by calling a special endpoint or just re-sending with createdAt as completedAt.
    // Since receiveCommission checks for duplicates by orderId+source and skips them,
    // we need to use a "force" approach. We'll rely on the fact that the endpoint
    // already has idempotency check - duplicates are skipped, so we just need to
    // ensure completedAt is correct. For a full re-sync, we need to delete old records first.
    // We'll skip deletion and just accept the duplicate check will skip already-imported ones.
    // The key fix: use createdAt instead of endTime so dates align with Taksometr stats.

    const snapshot = await db.collection("deliveries")
      .where("status", "==", "COMPLETED")
      .get();

    let sent = 0;
    let skipped = 0;
    let duplicates = 0;
    let errors = 0;

    // Process in parallel batches of 20 for speed
    const BATCH_SIZE = 20;
    const payloads: Array<{docId: string; payload: any}> = [];

    for (const doc of snapshot.docs) {
      const d = doc.data();
      const commission = d.commission || 0;
      if (commission <= 0) { skipped++; continue; }

      const rawCreatedAt = d.createdAt || d.endTime || Date.now();
      const completedAt = new Date(rawCreatedAt).toISOString();

      payloads.push({
        docId: doc.id,
        payload: {
          source: "taksometr",
          orderId: doc.id,
          driverId: d.courierId || "",
          driverName: d.courierName || "Неизвестный",
          commissionAmount: commission,
          orderAmount: d.cost || 0,
          commissionPercent: d.cost > 0 ? Math.round((commission / d.cost) * 1000) / 10 : 0,
          orderType: d.deliveryType || "default",
          completedAt: completedAt,
        },
      });
    }

    // Send in parallel batches
    for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
      const batch = payloads.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ({ payload }) => {
          const pushResp = await fetch(ZAKI_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(ZAKI_KEY ? { "x-api-key": ZAKI_KEY } : {}),
            },
            body: JSON.stringify(payload),
          });
          if (pushResp.ok) {
            const body: any = await pushResp.json().catch(() => ({}));
            return body.duplicate ? "duplicate" : "sent";
          }
          return "error";
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          if (r.value === "sent") sent++;
          else if (r.value === "duplicate") duplicates++;
          else errors++;
        } else {
          errors++;
        }
      }
    }

    res.status(200).json({
      total: snapshot.size,
      sent,
      duplicates,
      skipped,
      errors,
    });
  } catch (e: any) {
    console.error("migrateCommissionsToRashod error:", e);
    res.status(500).json({ error: e.message || "Unknown error" });
  }
});

// ============ ADMIN: ANNOUNCE WINNER OF THE MONTH ============
/**
 * Announce the "Winner of the Month" (Победитель месяца).
 *
 * The admin picks a courier and fills in a congratulation form:
 *  - congratsText: the personal congratulation shown to the winner
 *  - prizeAmount:  the prize/bonus amount (in сомони)
 *  - orderCount:   number of completed deliveries in the chosen period
 *  - periodStart / periodEnd: the date range the order count refers to
 *  - expiresAt:    until when the announcement should be shown in the app
 *
 * This writes a document to `winner_announcements` (which every courier app
 * observes in real time) and pushes an FCM message:
 *  - to the WINNER  → the full personal congratulation
 *  - to EVERYONE else → a short summary (who won, prize, order count)
 */
export const announceWinner = functions.https.onCall(async (data, context) => {
  const {
    adminId,
    winnerId,
    congratsText,
    prizeAmount,
    orderCount,
    periodStart,
    periodEnd,
    expiresAt,
  } = data;

  // Only admins / super admin may announce a winner.
  await verifyAdmin(adminId);

  if (!winnerId) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "winnerId is required"
    );
  }

  const winnerDoc = await db.collection("users").doc(winnerId).get();
  if (!winnerDoc.exists || winnerDoc.data()?.role !== "COURIER") {
    throw new functions.https.HttpsError("not-found", "Winner (courier) not found");
  }

  const winnerData = winnerDoc.data()!;
  const winnerName = `${winnerData.name || ""} ${winnerData.surname || ""}`.trim() ||
    (winnerData.name || "Курьер");

  const now = Date.now();
  const prize = Number(prizeAmount) || 0;
  const orders = Number(orderCount) || 0;
  // Default: show the congratulation for 7 days if no expiry is provided.
  const expiry = Number(expiresAt) || (now + 7 * 86400000);

  const text = (typeof congratsText === "string" && congratsText.trim().length > 0)
    ? congratsText.trim()
    : `Поздравляем ${winnerName} с победой в этом месяце!`;

  // Short summary shown to every other courier.
  const shortText =
    `🏆 Победитель месяца — ${winnerName}! ` +
    `Премия: ${prize} сомони, доставок: ${orders}. Поздравляем!`;

  // Persist the announcement. The courier apps observe this collection and
  // show the congratulation (full for the winner, short for others) until
  // `expiresAt`.
  const announcementRef = db.collection("winner_announcements").doc();
  await announcementRef.set({
    winnerId,
    winnerName,
    congratsText: text,
    shortText,
    prizeAmount: prize,
    orderCount: orders,
    periodStart: Number(periodStart) || 0,
    periodEnd: Number(periodEnd) || now,
    expiresAt: expiry,
    createdAt: now,
    createdBy: adminId,
    isActive: true,
  });

  // Push notifications to all couriers.
  const courierDocs = await db.collection("users")
    .where("role", "==", "COURIER")
    .get();

  let winnerNotified = false;
  let othersNotified = 0;

  for (const courierDoc of courierDocs.docs) {
    const courierData = courierDoc.data();
    if (courierDoc.id === winnerId) {
      await sendPushToCourier(courierData, {
        title: "🎉 Поздравляем! Вы — победитель месяца!",
        body: text,
        data: {
          type: "WINNER_ANNOUNCEMENT",
          announcementId: announcementRef.id,
          winnerRole: "WINNER",
        },
      }, {withSystemNotification: true});
      winnerNotified = true;
    } else {
      await sendPushToCourier(courierData, {
        title: "🏆 Победитель месяца",
        body: shortText,
        data: {
          type: "WINNER_ANNOUNCEMENT",
          announcementId: announcementRef.id,
          winnerRole: "OTHER",
        },
      }, {withSystemNotification: true});
      othersNotified++;
    }
  }

  return {
    success: true,
    announcementId: announcementRef.id,
    winnerName,
    winnerNotified,
    othersNotified,
  };
});

// ============================================================
// MOTOROL_TJ FOOD ORDER INTEGRATION (ADDITIVE)
// ------------------------------------------------------------
// Inbound: motorol_tj publishes an APPROVED food order here; we create a
// PENDING MARKETPLACE delivery so any eligible courier can accept it exactly
// like a normal Taksometr order. Outbound: when that delivery is accepted or
// completed, we sync the status back to motorol_tj so the client and admin see
// it in real time. NONE of the existing delivery functions are modified.
// ============================================================

interface MotorolOrderItem {
  name: string;
  quantity: number;
  price: number;
}

/**
 * HTTP endpoint called by motorol_tj when an admin approves a food order.
 * Auth: header `x-api-key` must equal env MOTOROL_ORDER_API_KEY.
 *
 * Expected JSON body:
 * {
 *   orderId: string,          // motorol_tj order id (sync key, idempotency)
 *   orderNumber?: string,
 *   clientPhone?: string,
 *   restaurantName?: string,
 *   restaurantAddress?: string,
 *   pickup: { address?: string, latitude: number, longitude: number },   // restaurant
 *   destination?: { address?: string, latitude: number, longitude: number }, // client
 *   items?: Array<{ name: string, quantity: number, price: number }>,
 *   productsPrice?: number,
 *   deliveryFee?: number,     // fixed courier payment (no meter)
 *   totalPrice?: number,
 *   comment?: string
 * }
 */
export const receiveMarketplaceOrderFromMotorol = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed. Use POST."});
    return;
  }

  const apiKey = process.env.MOTOROL_ORDER_API_KEY || "";
  if (apiKey) {
    const incoming = req.headers["x-api-key"] || "";
    if (incoming !== apiKey) {
      console.warn("receiveMarketplaceOrderFromMotorol: unauthorized request");
      res.status(401).json({error: "Unauthorized"});
      return;
    }
  } else {
    console.warn("receiveMarketplaceOrderFromMotorol: MOTOROL_ORDER_API_KEY not set — accepting without auth!");
  }

  try {
    const body = req.body || {};
    const orderId = String(body.orderId || "");
    const clientPhone = String(body.clientPhone || "");
    const pickup = body.pickup || {};

    if (!orderId) {
      res.status(400).json({error: "orderId is required"});
      return;
    }
    if (typeof pickup.latitude !== "number" || typeof pickup.longitude !== "number") {
      res.status(400).json({error: "pickup coordinates (latitude/longitude) are required"});
      return;
    }

    // Idempotency: never create the same motorol order twice.
    const existing = await db.collection("deliveries")
      .where("motorolOrderId", "==", orderId)
      .limit(1)
      .get();
    if (!existing.empty) {
      const existingId = existing.docs[0].id;
      console.log(`receiveMarketplaceOrderFromMotorol: duplicate skipped orderId=${orderId} docId=${existingId}`);
      res.status(200).json({success: true, deliveryId: existingId, duplicate: true});
      return;
    }

    const hasDestination =
      body.destination &&
      typeof body.destination.latitude === "number" &&
      typeof body.destination.longitude === "number";

    const items: MotorolOrderItem[] = Array.isArray(body.items) ?
      body.items.map((it: any) => ({
        name: String(it.name || it.product_name || "Позиция"),
        quantity: Number(it.quantity || 1),
        price: Number(it.price || 0),
      })) : [];

    const deliveryFee = Number(body.deliveryFee || 0);
    const productsPrice = Number(body.productsPrice || 0);
    const totalPrice = Number(
      body.totalPrice != null ? body.totalPrice : (productsPrice + deliveryFee)
    );
    const restaurantName = String(
      body.restaurantName || (body.restaurant && body.restaurant.name) || ""
    );
    const restaurantAddress = String(
      body.restaurantAddress ||
      (body.restaurant && body.restaurant.address) ||
      pickup.address || ""
    );

    // Eligible couriers = same rule as the marketplace path of
    // adminCreateMarketplaceDelivery (role COURIER, not blocked, on shift).
    const courierDocs = await db.collection("users")
      .where("role", "==", "COURIER")
      .where("isBlocked", "==", false)
      .get();

    const availableCourierIds: string[] = [];
    for (const courierDoc of courierDocs.docs) {
      if (courierDoc.data()?.isOnShift === false) continue;
      availableCourierIds.push(courierDoc.id);
    }

    const tariff = await getDefaultTariffSnapshot();
    const deliveryRef = db.collection("deliveries").doc();
    const now = Date.now();

    // Build a human-readable comment that ALWAYS shows the restaurant + items,
    // so even courier app builds that don't yet render the new structured
    // fields still display everything in the existing comment block.
    const itemsText = items.map((it) => `• ${it.name} ×${it.quantity}`).join("\n");
    const commentParts: string[] = [];
    if (restaurantName) commentParts.push(`🍽 Ресторан: ${restaurantName}`);
    if (itemsText) commentParts.push(`Блюда:\n${itemsText}`);
    if (body.comment) commentParts.push(String(body.comment));
    const comment = commentParts.join("\n");

    await deliveryRef.set({
      courierId: "",
      courierName: "",
      clientPhone: clientPhone,
      status: "PENDING",
      adminOrderStage: "NEW",
      orderSource: "MOTOROL",
      orderKind: "MARKETPLACE",
      // --- motorol integration markers (new, ignored by existing code) ---
      source: "motorol_tj",
      motorolOrderId: orderId,
      motorolOrderNumber: String(body.orderNumber || ""),
      // Fixed price (no meter): courier is paid the delivery fee from motorol.
      // deliveryType != "default"/"heavyCargoMeter" makes completeDelivery use
      // fixedPrice instead of the distance meter.
      deliveryType: deliveryFee > 0 ? "food" : "default",
      fixedPrice: deliveryFee > 0 ? deliveryFee : null,
      // --- restaurant + items (new structured fields) ---
      restaurantName: restaurantName,
      restaurant: {name: restaurantName, address: restaurantAddress},
      items: items,
      productsPrice: productsPrice,
      totalPrice: totalPrice,
      // --- standard delivery fields ---
      startTime: null,
      acceptedAt: null,
      endTime: null,
      distanceMeters: 0,
      cost: 0,
      route: [],
      createdAt: now,
      adminCreatedAt: now,
      comment: comment,
      pickup: {
        address: String(pickup.address || restaurantAddress || ""),
        latitude: pickup.latitude,
        longitude: pickup.longitude,
      },
      destination: hasDestination ? {
        address: String(body.destination.address || ""),
        latitude: body.destination.latitude,
        longitude: body.destination.longitude,
      } : null,
      availableCourierIds: availableCourierIds,
      waitingMinutes: 0,
      waitingCost: 0,
      waitingStartedAt: null,
      tariffSnapshot: tariff,
    });

    // Notify eligible couriers (same as marketplace order push).
    for (const courierId of availableCourierIds) {
      const courierDoc = await db.collection("users").doc(courierId).get();
      if (!courierDoc.exists) continue;
      await sendPushToCourier(courierDoc.data(), {
        title: "Новый заказ еды",
        body: restaurantName ? `Заказ из ${restaurantName}` : "Новый заказ на доставку",
        data: {
          type: "ADMIN_MARKETPLACE_ORDER",
          deliveryId: deliveryRef.id,
        },
      });
    }

    console.log(`receiveMarketplaceOrderFromMotorol: created deliveryId=${deliveryRef.id} orderId=${orderId} couriers=${availableCourierIds.length}`);
    res.status(200).json({
      success: true,
      deliveryId: deliveryRef.id,
      availableCouriers: availableCourierIds.length,
    });
  } catch (error: any) {
    console.error("receiveMarketplaceOrderFromMotorol error:", error);
    res.status(500).json({error: "Internal server error", details: error.message});
  }
});

/**
 * Firestore trigger: when a motorol-sourced delivery changes status, sync the
 * status back to motorol_tj so the client and admin see it in real time.
 * Additive — does not touch acceptMarketplaceDelivery/completeDelivery.
 *
 * IN_PROGRESS -> motorol "accepted", COMPLETED -> "completed",
 * CANCELLED -> "cancelled".
 *
 * Requires env: MOTOROL_ORDER_STATUS_URL, MOTOROL_ORDER_STATUS_API_KEY.
 */
export const onMotorolDeliveryStatusChange = functions.firestore
  .document("deliveries/{deliveryId}")
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after) return null;

    // Only motorol-sourced orders.
    if (after.source !== "motorol_tj" && !after.motorolOrderId) return null;
    // Only on real status change.
    if (before.status === after.status) return null;

    let motorolStatus: string | null = null;
    if (after.status === "IN_PROGRESS") motorolStatus = "accepted";
    else if (after.status === "COMPLETED") motorolStatus = "completed";
    else if (after.status === "CANCELLED") motorolStatus = "cancelled";
    if (!motorolStatus) return null;

    const url = process.env.MOTOROL_ORDER_STATUS_URL || "";
    const key = process.env.MOTOROL_ORDER_STATUS_API_KEY || "";
    if (!url) {
      console.warn("onMotorolDeliveryStatusChange: MOTOROL_ORDER_STATUS_URL not set, skipping status sync");
      return null;
    }

    const payload = {
      source: "taksometr",
      orderId: String(after.motorolOrderId || ""),
      status: motorolStatus,
      courierId: String(after.courierId || ""),
      courierName: String(after.courierName || ""),
    };

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? {"x-api-key": key} : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error(`onMotorolDeliveryStatusChange: motorol sync failed (${resp.status}): ${errText}`);
      } else {
        console.log(`onMotorolDeliveryStatusChange: synced status=${motorolStatus} orderId=${payload.orderId}`);
      }
    } catch (err) {
      console.error("onMotorolDeliveryStatusChange: error syncing to motorol:", err);
    }

    return null;
  });
