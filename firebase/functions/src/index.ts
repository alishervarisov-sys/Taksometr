import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

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
 * Format a cost value (somoni) for SMS text without trailing decimals.
 */
function formatCostForSms(cost: number): string {
  return new Intl.NumberFormat("ru-RU", {maximumFractionDigits: 0}).format(cost);
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

function calculateRouteDistance(route: Array<{latitude: number; longitude: number}>): number {
  let totalDistance = 0;
  for (let i = 1; i < route.length; i++) {
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
  return Math.max(baseCost, Math.ceil(cost));
}

// ============ CREATE DELIVERY ============
export const createDelivery = functions.https.onCall(async (data, context) => {
  const {courierId, clientPhone} = data;

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

  // Check for active delivery
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

  // Create delivery
  const deliveryRef = db.collection("deliveries").doc();
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
    createdAt: Date.now(),
  };

  await deliveryRef.set(deliveryData);

  // ---- Notify client by SMS that the courier started the meter (Tajik) ----
  const courierName = courierData.name || "";
  const courierPhone = courierData.phone || "";
  const startSmsText = courierPhone ?
    `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. ` +
    `Расонанда: ${courierName}, тел: ${courierPhone}.` :
    `Салом! Расонандаи ZaKi фармоиши шуморо қабул кард. Расонанда: ${courierName}.`;

  await sendSms(clientPhone, startSmsText);

  return {
    deliveryId: deliveryRef.id,
    courierName: courierData.name || "",
  };
});

// ============ COMPLETE DELIVERY ============
export const completeDelivery = functions.https.onCall(async (data, context) => {
  const {deliveryId, courierId, route, endTime} = data;

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

  // Calculate distance from route
  const routePoints = route || [];
  const distanceMeters = calculateRouteDistance(routePoints);

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

  // Calculate cost: base covers baseDistanceKm, then costPerKm beyond
  const roundedCost = computeCost(distanceMeters, baseCost, baseDistanceKm, costPerKm);

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
  const commissionAmount = Math.ceil(roundedCost * commissionPercent / 100);

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

  // Update delivery
  await deliveryRef.update({
    status: "COMPLETED",
    endTime: endTime || Date.now(),
    distanceMeters: distanceMeters,
    cost: roundedCost,
    commission: commissionAmount,
    route: routePoints,
  });

  // ---- Notify client by SMS about the final delivery total (Tajik) ----
  const distanceKmText = (distanceMeters / 1000).toFixed(1);
  const completeSmsText =
    `Фармоиши ZaKi анҷом ёфт. ` +
    `Масофа: ${distanceKmText} км. ` +
    `Маблағи умумӣ: ${formatCostForSms(roundedCost)} сомонӣ. ` +
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
    cost: roundedCost,
    commission: commissionAmount,
  };
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

// ============ ADMIN: CREATE COURIER ============
export const createCourier = functions.https.onCall(async (data, context) => {
  const {login, password, name, phone, adminId} = data;

  // Verify admin
  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only admins can create couriers"
    );
  }

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
    name: name,
    phone: phone || "",
    role: "COURIER",
    isOnline: false,
    isBlocked: false,
    balance: 0,
    createdAt: Date.now(),
    fcmToken: "",
    lastLocation: null,
  });

  return {
    userId: userRef.id,
    login: login,
    name: name,
  };
});

// ============ ADMIN: UPDATE TARIFF ============
export const updateTariff = functions.https.onCall(async (data, context) => {
  const {adminId, baseCost, baseDistanceKm, costPerKm} = data;

  // Verify admin
  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only admins can update tariffs"
    );
  }

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
  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Only admins can view statistics"
    );
  }

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

  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError("permission-denied", "Only admins");
  }

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
  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError("permission-denied", "Only admins");
  }

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

  // Send push notification to courier
  const fcmToken = courierData.fcmToken;
  if (fcmToken) {
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: "Баланс пополнен",
          body: `+${amount} сомони. Новый баланс: ${newBalance} сомони`,
        },
        data: {
          type: "BALANCE_TOP_UP",
          amount: String(amount),
          newBalance: String(newBalance),
        },
      });
    } catch (e) {
      // FCM send failure is not critical
      console.error("FCM send error:", e);
    }
  }

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

  // Verify admin
  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError("permission-denied", "Only admins");
  }

  if (!courierId) {
    throw new functions.https.HttpsError("invalid-argument", "courierId required");
  }

  const courierDoc = await db.collection("users").doc(courierId).get();
  if (!courierDoc.exists) {
    throw new functions.https.HttpsError("not-found", "Courier not found");
  }

  const courierData = courierDoc.data()!;
  const fcmToken = courierData.fcmToken;

  if (!fcmToken) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "У курьера нет FCM токена. Приложение не было запущено."
    );
  }

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
  } catch (e: any) {
    throw new functions.https.HttpsError(
      "unavailable",
      "Не удалось отправить запрос на устройство курьера"
    );
  }

  return {success: true, message: "Запрос отправлен. Местоположение обновится через несколько секунд."};
});


// ============ ADMIN: UPDATE COURIER COMMISSION ============
// Sets an individual commission percentage for a specific courier.
// If set, it overrides the global commission from settings/commission.
export const updateCourierCommission = functions.https.onCall(async (data, context) => {
  const {adminId, courierId, percent} = data;

  const adminDoc = await db.collection("users").doc(adminId).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== "ADMIN") {
    throw new functions.https.HttpsError("permission-denied", "Only admins");
  }

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
