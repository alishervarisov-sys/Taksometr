/**
 * ============================================================
 *  ZaKi TAXI — Driver Management Module
 * ============================================================
 *  Exports:
 *    TaxiDriverDoc          — Firestore document interface
 *    approveTaxiDriver      — Callable: admin approves a driver
 *    rejectTaxiDriver       — Callable: admin rejects a driver
 *    blockTaxiDriver        — Callable: admin blocks a driver
 *    sendTaxiBroadcast      — Callable: send Telegram msg to drivers
 *
 *  Firestore collections used:
 *    taxiDrivers/{telegramId}
 *    taxiAuditLog/{auto-id}
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

const getDb = (): admin.firestore.Firestore => admin.firestore();

const TAXI_BOT_TOKEN = process.env.TAXI_BOT_TOKEN || "8924777044:AAGIpsy8FaaamVVrIO_d3OrQh-wFp9rIK_0";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaxiDriverDoc {
  telegramId: string;
  telegramUsername: string;
  telegramPhotoUrl: string;
  firstName: string;
  lastName: string;
  birthYear: string;
  phone: string;
  passport: string;
  driverLicense: string;
  passportLicense: string;
  carBrand: string;
  carModel: string;
  carColor: string;
  carNumber: string;
  status: "pending" | "approved" | "rejected" | "blocked";
  driverStatus: "online" | "offline" | "on_order";
  photos: {
    passport: string;
    driverLicense: string;
    license: string;
    techPassport: string;
    carFront: string;
    carBack: string;
    carInterior: string;
  };
  completedTrips: number;
  cancelledTrips: number;
  missedOrders: number;
  totalEarnings: number;
  totalCommission: number;
  registeredAt: number;
  lastActiveAt: number;
  approvedBy?: string;
  approvedAt?: number;
  rejectedBy?: string;
  rejectedAt?: number;
  blockedBy?: string;
  blockedAt?: number;
  blockedReason?: string;
}

// ─── Telegram helper ──────────────────────────────────────────────────────────

async function sendMsg(chatId: number | string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[TaxiDrivers] sendMsg error:", e);
  }
}

// ─── Admin verifier ───────────────────────────────────────────────────────────

async function verifyAdmin(adminId: string): Promise<void> {
  if (adminId === "SUPER_ADMIN") return;
  const snap = await getDb().collection("users").doc(adminId).get();
  if (!snap.exists || !["ADMIN", "SUPER_ADMIN"].includes(snap.data()?.role)) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
}

// ─── Audit logger ─────────────────────────────────────────────────────────────

async function logAudit(fields: {
  action: string;
  driverId?: string;
  driverName?: string;
  adminId?: string;
  details: string;
}): Promise<void> {
  await getDb().collection("taxiAuditLog").add({
    ...fields,
    timestamp: Date.now(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: approveTaxiDriver
// ═══════════════════════════════════════════════════════════════════════════════

export const approveTaxiDriver = functions.https.onCall(async (data) => {
  const { adminId, driverId } = data as { adminId: string; driverId: string };
  await verifyAdmin(adminId);

  const ref  = getDb().collection("taxiDrivers").doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "Driver not found");

  await ref.update({
    status: "approved",
    driverStatus: "offline",
    approvedBy: adminId,
    approvedAt: Date.now(),
  });

  const d = snap.data() as TaxiDriverDoc;
  await logAudit({
    action: "driver_approved",
    driverId,
    driverName: `${d.firstName} ${d.lastName}`,
    adminId,
    details: "Водитель одобрен администратором",
  });

  await sendMsg(
    d.telegramId,
    "✅ <b>Поздравляем!</b> Ваша регистрация одобрена.\nТеперь вы можете принимать заказы ZaKi Taxi."
  );

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: rejectTaxiDriver
// ═══════════════════════════════════════════════════════════════════════════════

export const rejectTaxiDriver = functions.https.onCall(async (data) => {
  const { adminId, driverId, reason } = data as {
    adminId: string; driverId: string; reason?: string;
  };
  await verifyAdmin(adminId);

  const ref  = getDb().collection("taxiDrivers").doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "Driver not found");

  await ref.update({
    status: "rejected",
    rejectedBy: adminId,
    rejectedAt: Date.now(),
    blockedReason: reason ?? "",
  });

  const d = snap.data() as TaxiDriverDoc;
  await logAudit({
    action: "driver_rejected",
    driverId,
    driverName: `${d.firstName} ${d.lastName}`,
    adminId,
    details: `Заявка отклонена. Причина: ${reason ?? "не указана"}`,
  });

  const msg = reason
    ? `❌ Ваша заявка <b>отклонена</b>.\nПричина: ${reason}`
    : "❌ Ваша заявка <b>отклонена</b>. Свяжитесь с администратором.";
  await sendMsg(d.telegramId, msg);

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: blockTaxiDriver
// ═══════════════════════════════════════════════════════════════════════════════

export const blockTaxiDriver = functions.https.onCall(async (data) => {
  const { adminId, driverId, reason } = data as {
    adminId: string; driverId: string; reason?: string;
  };
  await verifyAdmin(adminId);

  const ref  = getDb().collection("taxiDrivers").doc(driverId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "Driver not found");

  await ref.update({
    status: "blocked",
    driverStatus: "offline",
    blockedBy: adminId,
    blockedAt: Date.now(),
    blockedReason: reason ?? "",
  });

  const d = snap.data() as TaxiDriverDoc;
  await logAudit({
    action: "driver_blocked",
    driverId,
    driverName: `${d.firstName} ${d.lastName}`,
    adminId,
    details: `Водитель заблокирован. Причина: ${reason ?? "не указана"}`,
  });

  const msg = reason
    ? `🚫 Ваш аккаунт <b>заблокирован</b>.\nПричина: ${reason}`
    : "🚫 Ваш аккаунт <b>заблокирован</b>. Свяжитесь с администратором.";
  await sendMsg(d.telegramId, msg);

  return { success: true };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: sendTaxiBroadcast
// ═══════════════════════════════════════════════════════════════════════════════

export const sendTaxiBroadcast = functions.https.onCall(async (data) => {
  const { adminId, message, targetStatus } = data as {
    adminId: string;
    message: string;
    targetStatus?: "approved" | "pending" | "all";
  };
  await verifyAdmin(adminId);

  if (!message?.trim()) {
    throw new functions.https.HttpsError("invalid-argument", "message is required");
  }

  let q: admin.firestore.Query = getDb().collection("taxiDrivers");
  if (targetStatus && targetStatus !== "all") {
    q = q.where("status", "==", targetStatus);
  }

  const snap = await q.get();
  let sent = 0;

  for (const doc of snap.docs) {
    const d = doc.data() as TaxiDriverDoc;
    try {
      await sendMsg(d.telegramId, `📢 <b>ZaKi Taxi</b>\n\n${message}`);
      sent++;
    } catch (_) {
      /* skip unreachable drivers */
    }
  }

  await logAudit({
    action: "broadcast_sent",
    adminId,
    details: `Рассылка отправлена ${sent} водителям. Текст: "${message.slice(0, 80)}"`,
  });

  return { success: true, sent };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: createTaxiDriverByAdmin
//  Admin manually registers a driver — immediately approved.
//  Telegram ID is required so the driver can receive orders.
// ═══════════════════════════════════════════════════════════════════════════════

export const createTaxiDriverByAdmin = functions.https.onCall(async (data) => {
  const {
    adminId, telegramId, telegramUsername,
    firstName, lastName, birthYear, phone,
    passport, driverLicense, passportLicense,
    carBrand, carModel, carColor, carNumber,
  } = data as {
    adminId: string;
    telegramId: string;
    telegramUsername?: string;
    firstName: string;
    lastName: string;
    birthYear?: string;
    phone: string;
    passport?: string;
    driverLicense?: string;
    passportLicense?: string;
    carBrand: string;
    carModel: string;
    carColor: string;
    carNumber: string;
  };

  await verifyAdmin(adminId);

  if (!telegramId?.trim() || !firstName?.trim() || !lastName?.trim() ||
      !phone?.trim() || !carBrand?.trim() || !carModel?.trim() ||
      !carColor?.trim() || !carNumber?.trim()) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "telegramId, firstName, lastName, phone, carBrand, carModel, carColor, carNumber are required",
    );
  }

  const ref = getDb().collection("taxiDrivers").doc(telegramId.trim());
  const existing = await ref.get();
  if (existing.exists) {
    throw new functions.https.HttpsError(
      "already-exists",
      "Водитель с этим Telegram ID уже зарегистрирован",
    );
  }

  const now = Date.now();
  const driverDoc: TaxiDriverDoc = {
    telegramId:       telegramId.trim(),
    telegramUsername: telegramUsername?.trim() ?? "",
    telegramPhotoUrl: "",
    firstName:        firstName.trim(),
    lastName:         lastName.trim(),
    birthYear:        birthYear?.trim() ?? "",
    phone:            phone.trim(),
    passport:         passport?.trim() ?? "",
    driverLicense:    driverLicense?.trim() ?? "",
    passportLicense:  passportLicense?.trim() ?? "",
    carBrand:         carBrand.trim(),
    carModel:         carModel.trim(),
    carColor:         carColor.trim(),
    carNumber:        carNumber.trim(),
    status:           "approved",
    driverStatus:     "offline",
    photos: { passport: "", driverLicense: "", license: "", techPassport: "", carFront: "", carBack: "", carInterior: "" },
    completedTrips: 0, cancelledTrips: 0, missedOrders: 0,
    totalEarnings: 0,  totalCommission: 0,
    registeredAt:  now,
    lastActiveAt:  now,
    approvedBy:    adminId,
    approvedAt:    now,
  };

  await ref.set(driverDoc);

  await logAudit({
    action:     "driver_created_by_admin",
    driverId:   telegramId.trim(),
    driverName: `${firstName} ${lastName}`,
    adminId,
    details:    `Водитель создан администратором: ${firstName} ${lastName}, авто: ${carBrand} ${carModel} ${carNumber}`,
  });

  // Notify the driver if they're already a bot member
  try {
    await sendMsg(
      telegramId.trim(),
      `✅ <b>Добро пожаловать в ZaKi Taxi!</b>\n\nВы зарегистрированы как водитель и можете принимать заказы.\n\n🚗 ${carBrand} ${carModel} — ${carNumber}`,
    );
  } catch (_) { /* driver may not have started the bot yet */ }

  return { success: true, driverId: telegramId.trim() };
});
