/**
 * ============================================================
 *  ZaKi TAXI — Cloud Functions Module
 *  Isolated from the delivery module. Do not mix with index.ts.
 * ============================================================
 *
 *  Exports:
 *    createTaxiOrder      — Callable: dispatcher creates an order
 *    taxiTelegramPoller   — Scheduled (every 1 min): polls Telegram
 *                           getUpdates, processes "Принять заказ" presses.
 *                           No webhook registration needed.
 *
 *  Environment variables (firebase/functions/.env):
 *    TAXI_BOT_TOKEN          — Telegram bot token for the taxi group
 *    TAXI_TELEGRAM_CHAT_ID   — Telegram chat/group ID for taxi drivers
 *    PAYOM_API_HOST          — Payom.tj SMS host (shared with delivery)
 *    PAYOM_API_TOKEN         — Payom.tj bearer token  (shared)
 *    PAYOM_SENDER_NAME       — SMS sender name         (shared)
 */

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { TaxiDriverDoc } from "./taxiDrivers";

// ─── Lazy DB accessor (admin.initializeApp must be called in index.ts first) ─

const getDb = (): admin.firestore.Firestore => admin.firestore();

// ─── Config ──────────────────────────────────────────────────────────────────

const TAXI_BOT_TOKEN        = process.env.TAXI_BOT_TOKEN        || "8924777044:AAGIpsy8FaaamVVrIO_d3OrQh-wFp9rIK_0";
const TAXI_TELEGRAM_CHAT_ID = process.env.TAXI_TELEGRAM_CHAT_ID || "-5359088909";

const PAYOM_API_HOST    = process.env.PAYOM_API_HOST    || "https://gateway.payom.tj";
const PAYOM_API_TOKEN   = process.env.PAYOM_API_TOKEN   || "";
const PAYOM_SENDER_NAME = process.env.PAYOM_SENDER_NAME || "ZaKi";

// ─── Phone normalisation (duplicate from delivery module — kept isolated) ────

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  digits = digits.replace(/(?!^)\+/g, "");
  if (digits.startsWith("+"))  digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("992")) digits = digits.replace(/^992/, "");
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^\d{9}$/.test(digits)) return null;
  return `+992${digits}`;
}

// ─── SMS via Payom.tj ────────────────────────────────────────────────────────

async function sendTaxiSms(telephoneRaw: string, text: string): Promise<void> {
  const telephone = normalizePhone(telephoneRaw);
  if (!telephone) {
    console.warn(`[Taxi SMS] Skipped — invalid phone: "${telephoneRaw}"`);
    return;
  }
  if (!PAYOM_API_TOKEN) {
    console.warn("[Taxi SMS] Skipped — PAYOM_API_TOKEN not set");
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
      body: JSON.stringify({ telephone, text, senderName: PAYOM_SENDER_NAME, type: "SMS" }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[Taxi SMS] Payom.tj failed (${response.status}): ${err}`);
      return;
    }
    const result: any = await response.json().catch(() => ({}));
    console.log(`[Taxi SMS] Sent to ${telephone}, id=${result.id ?? "?"}`);
  } catch (e) {
    console.error("[Taxi SMS] Request error:", e);
  }
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

/**
 * Send a message to the taxi drivers' group with an inline "Accept" button.
 * Returns the Telegram message_id, or null on failure.
 */
async function sendTaxiTelegramWithButton(text: string, orderId: string): Promise<number | null> {
  if (!TAXI_BOT_TOKEN || !TAXI_TELEGRAM_CHAT_ID) {
    console.warn("[Taxi Telegram] TAXI_BOT_TOKEN or TAXI_TELEGRAM_CHAT_ID not configured");
    return null;
  }
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TAXI_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TAXI_TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Принять заказ", callback_data: `accept_taxi:${orderId}` },
            ]],
          },
        }),
      },
    );
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[Taxi Telegram] sendMessage failed (${response.status}): ${err}`);
      return null;
    }
    const result: any = await response.json().catch(() => ({}));
    const msgId: number | null = result?.result?.message_id ?? null;
    console.log(`[Taxi Telegram] Message sent, message_id=${msgId}`);
    return msgId;
  } catch (e) {
    console.error("[Taxi Telegram] sendMessage error:", e);
    return null;
  }
}

/** Replace the taxi order message text, optionally adding a reply_markup. */
async function editTaxiTelegramMessage(messageId: number, newText: string, replyMarkup?: any): Promise<void> {
  if (!TAXI_BOT_TOKEN || !TAXI_TELEGRAM_CHAT_ID) return;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TAXI_BOT_TOKEN}/editMessageText`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TAXI_TELEGRAM_CHAT_ID,
          message_id: messageId,
          text: newText,
          parse_mode: "HTML",
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      },
    );
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[Taxi Telegram] editMessageText failed (${response.status}): ${err}`);
    }
  } catch (e) {
    console.error("[Taxi Telegram] editMessageText error:", e);
  }
}

/** Acknowledge a Telegram callback_query (must be done within 10 s). */
async function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert = false,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
    });
  } catch (e) {
    console.error("[Taxi Telegram] answerCallbackQuery error:", e);
  }
}

/** Fetch pending updates from Telegram (instant, no long-poll). */
async function getTelegramUpdates(offset: number): Promise<any[]> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TAXI_BOT_TOKEN}/getUpdates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset,
          timeout: 0,
          allowed_updates: ["callback_query", "message"], // messages for registration
        }),
      },
    );
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[Taxi Poller] getUpdates failed (${response.status}): ${err}`);
      return [];
    }
    const result: any = await response.json().catch(() => ({}));
    return result?.result ?? [];
  } catch (e) {
    console.error("[Taxi Poller] getUpdates error:", e);
    return [];
  }
}

// ─── Auto-incrementing order number ──────────────────────────────────────────

async function getNextOrderNumber(): Promise<number> {
  const counterRef = getDb().collection("settings").doc("taxiCounter");
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current: number = snap.exists ? (snap.data()!.lastNumber ?? 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });
}

// ─── Tajikistan time helper ───────────────────────────────────────────────────

function toTjTimeStr(timestampMs: number): string {
  const TJ_OFFSET_MS = 5 * 60 * 60 * 1000;
  const d = new Date(timestampMs + TJ_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ─── Firestore document type ──────────────────────────────────────────────────

interface TaxiOrderDoc {
  orderNumber: number;
  customerPhone: string;
  pickup: string;
  destination: string;
  status: "waiting" | "accepted" | "completed" | "cancelled";
  driverTelegramId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverCarBrand: string | null;
  driverCarModel: string | null;
  driverCarColor: string | null;
  driverCarNumber: string | null;
  telegramMessageId: number | null;
  createdAt: number;
  acceptedAt: number | null;
}

// ─── Admin verification ─────────────────────────────────────────────────────

async function verifyTaxiAdmin(adminId: string): Promise<void> {
  if (adminId === "SUPER_ADMIN") return;
  const snap = await getDb().collection("users").doc(adminId).get();
  if (!snap.exists || !["ADMIN", "SUPER_ADMIN"].includes(snap.data()?.role)) {
    throw new functions.https.HttpsError("permission-denied", "Admins only");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOT REGISTRATION FLOW
//  State is stored in: taxiRegistrationSessions/{telegramId}
//  Completed drivers are saved to: taxiDrivers/{telegramId}
// ═══════════════════════════════════════════════════════════════════════════════

/** Send a simple message to any chat (used by registration bot). */
async function sendTaxiMessage(
  chatId: number | string,
  text: string,
  replyMarkup?: any,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (e) {
    console.error("[TaxiReg] sendTaxiMessage error:", e);
  }
}

/** Download a Telegram photo and store it in Firebase Storage. Returns public URL or null. */
async function downloadAndStorePhoto(
  fileId: string,
  telegramId: string,
  fieldName: string,
): Promise<string | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TAXI_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
    if (!fileRes.ok) return null;
    const fileData: any = await fileRes.json().catch(() => ({}));
    const filePath: string | undefined = fileData?.result?.file_path;
    if (!filePath) return null;

    const photoRes = await fetch(`https://api.telegram.org/file/bot${TAXI_BOT_TOKEN}/${filePath}`);
    if (!photoRes.ok) return null;
    const buffer = Buffer.from(await photoRes.arrayBuffer());

    const bucket   = admin.storage().bucket();
    const destPath = `taxi_driver_photos/${telegramId}/${fieldName}.jpg`;
    const file     = bucket.file(destPath);
    await file.save(buffer, { metadata: { contentType: "image/jpeg" } });
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${destPath}`;
  } catch (e) {
    console.error(`[TaxiReg] downloadAndStorePhoto(${fieldName}) error:`, e);
    return null;
  }
}

/** Check if a user has an active registration session. */
async function isActiveRegistration(telegramId: string): Promise<boolean> {
  if (!telegramId) return false;
  const snap = await getDb().collection("taxiRegistrationSessions").doc(telegramId).get();
  return snap.exists;
}

// Registration step definitions (18 steps total: 11 text + 7 photos)
const REG_STEPS = [
  { no: 1,  field: "firstName",       isPhoto: false, prompt: "📝 <b>Шаг 1/18</b>\n\nВведите ваше <b>имя</b>:" },
  { no: 2,  field: "lastName",        isPhoto: false, prompt: "📝 <b>Шаг 2/18</b>\n\nВведите вашу <b>фамилию</b>:" },
  { no: 3,  field: "birthYear",       isPhoto: false, prompt: "📝 <b>Шаг 3/18</b>\n\nВведите <b>год рождения</b>:" },
  { no: 4,  field: "phone",           isPhoto: false, prompt: "📝 <b>Шаг 4/18</b>\n\nВведите ваш <b>номер телефона</b>:" },
  { no: 5,  field: "passport",        isPhoto: false, prompt: "📝 <b>Шаг 5/18</b>\n\nВведите <b>серию и номер паспорта</b>:" },
  { no: 6,  field: "driverLicense",   isPhoto: false, prompt: "📝 <b>Шаг 6/18</b>\n\nВведите <b>номер водительского удостоверения</b>:" },
  { no: 7,  field: "passportLicense", isPhoto: false, prompt: "📝 <b>Шаг 7/18</b>\n\nВведите <b>номер лицензии на перевозку пассажиров</b>:" },
  { no: 8,  field: "carBrand",        isPhoto: false, prompt: "📝 <b>Шаг 8/18</b>\n\nВведите <b>марку автомобиля</b>\n(например: <i>Toyota</i>):" },
  { no: 9,  field: "carModel",        isPhoto: false, prompt: "📝 <b>Шаг 9/18</b>\n\nВведите <b>модель автомобиля</b>\n(например: <i>Corolla 2018</i>):" },
  { no: 10, field: "carColor",        isPhoto: false, prompt: "📝 <b>Шаг 10/18</b>\n\nВведите <b>цвет автомобиля</b>:" },
  { no: 11, field: "carNumber",       isPhoto: false, prompt: "📝 <b>Шаг 11/18</b>\n\nВведите <b>государственный номер автомобиля</b>\n(например: <i>1234AB01</i>):" },
  { no: 12, field: "photoPassport",       isPhoto: true, prompt: "📸 <b>Фото 1/7</b>\n\nОтправьте <b>фото паспорта</b>:" },
  { no: 13, field: "photoDriverLicense",  isPhoto: true, prompt: "📸 <b>Фото 2/7</b>\n\nОтправьте <b>фото водительского удостоверения</b>:" },
  { no: 14, field: "photoLicense",        isPhoto: true, prompt: "📸 <b>Фото 3/7</b>\n\nОтправьте <b>фото лицензии на перевозку пассажиров</b>:" },
  { no: 15, field: "photoTechPassport",   isPhoto: true, prompt: "📸 <b>Фото 4/7</b>\n\nОтправьте <b>фото техпаспорта автомобиля</b>:" },
  { no: 16, field: "photoCarFront",       isPhoto: true, prompt: "📸 <b>Фото 5/7</b>\n\nОтправьте <b>фото автомобиля спереди</b>:" },
  { no: 17, field: "photoCarBack",        isPhoto: true, prompt: "📸 <b>Фото 6/7</b>\n\nОтправьте <b>фото автомобиля сзади</b>:" },
  { no: 18, field: "photoCarInterior",    isPhoto: true, prompt: "📸 <b>Фото 7/7</b>\n\nОтправьте <b>фото салона автомобиля</b>:" },
] as const;

/** Route a Telegram update to the registration bot handler. */
async function handleTaxiBotUpdate(update: any): Promise<void> {
  const msg       = update.message;
  const cq        = update.callback_query;
  const from      = msg?.from ?? cq?.from ?? {};
  const chatId: number = msg?.chat?.id ?? from?.id;
  const telegramId: string = String(from?.id ?? "");
  const text: string = msg?.text?.trim() ?? "";

  if (!chatId || !telegramId) return;

  const driverRef  = getDb().collection("taxiDrivers").doc(telegramId);
  const sessionRef = getDb().collection("taxiRegistrationSessions").doc(telegramId);

  // ── /start command ────────────────────────────────────────────────────────
  if (text === "/start" && !cq) {
    const dSnap = await driverRef.get();
    if (dSnap.exists) {
      const s = (dSnap.data() as any).status;
      const messages: Record<string, string> = {
        approved: "✅ Вы уже <b>одобрены</b> как водитель ZaKi Taxi. Ожидайте заказов в группе.",
        pending:  "⏳ Ваша заявка <b>на проверке</b>. Ожидайте ответа администратора.",
        blocked:  "🚫 Ваш аккаунт <b>заблокирован</b>. Свяжитесь с администратором.",
        rejected: "❌ Ваша заявка была отклонена.",
      };
      if (messages[s]) {
        await sendTaxiMessage(chatId, messages[s]);
        if (s !== "rejected") return;
      }
    }
    await sendTaxiMessage(
      chatId,
      "👋 Добро пожаловать в <b>ZaKi Taxi</b>!\n\nНажмите кнопку ниже, чтобы зарегистрироваться как водитель:",
      { inline_keyboard: [[{ text: "🚖 Стать водителем ZaKi Taxi", callback_data: "register_driver" }]] },
    );
    return;
  }

  // ── "Стать водителем" button ──────────────────────────────────────────────
  if (cq?.data === "register_driver") {
    try {
      await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cq.id, text: "" }),
      });
    } catch (_) {}
    await sessionRef.set({ step: 1, data: {} });
    await sendTaxiMessage(chatId, REG_STEPS[0].prompt);
    return;
  }

  // ── Active registration session ───────────────────────────────────────────
  if (!msg) return;
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    await sendTaxiMessage(chatId, "Введите /start для начала регистрации.");
    return;
  }

  const session      = sessionSnap.data()!;
  const currentStep  = session.step as number;
  const stepDef      = REG_STEPS.find(s => s.no === currentStep);
  if (!stepDef) return;

  let value: string | null = null;

  if (stepDef.isPhoto) {
    const photos: any[] = msg.photo ?? [];
    if (photos.length === 0) {
      await sendTaxiMessage(chatId, `⚠️ Пожалуйста, отправьте <b>фотографию</b>.\n\n${stepDef.prompt}`);
      return;
    }
    const bestPhoto = photos[photos.length - 1]; // highest resolution
    const storageUrl = await downloadAndStorePhoto(bestPhoto.file_id, telegramId, stepDef.field);
    value = storageUrl ?? bestPhoto.file_id;
  } else {
    if (!text) {
      await sendTaxiMessage(chatId, `⚠️ Введите текстовое значение.\n\n${stepDef.prompt}`);
      return;
    }
    value = text;
  }

  const updatedData = { ...session.data, [stepDef.field]: value };

  if (currentStep < REG_STEPS.length) {
    await sessionRef.update({ step: currentStep + 1, data: updatedData });
    const next = REG_STEPS.find(s => s.no === currentStep + 1)!;
    await sendTaxiMessage(chatId, next.prompt);
  } else {
    // All 18 steps complete — finalise registration
    await sessionRef.delete();

    // Fetch Telegram profile photo
    let profilePhotoUrl = "";
    try {
      const ppRes  = await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/getUserProfilePhotos?user_id=${telegramId}&limit=1`);
      const ppData: any = await ppRes.json().catch(() => ({}));
      const fid    = ppData?.result?.photos?.[0]?.[0]?.file_id;
      if (fid) profilePhotoUrl = (await downloadAndStorePhoto(fid, telegramId, "profile")) ?? "";
    } catch (_) {}

    const d = updatedData;
    const driverDoc = {
      telegramId,
      telegramUsername: from.username ?? "",
      telegramPhotoUrl: profilePhotoUrl,
      firstName:        d.firstName        ?? "",
      lastName:         d.lastName         ?? "",
      birthYear:        d.birthYear        ?? "",
      phone:            d.phone            ?? "",
      passport:         d.passport         ?? "",
      driverLicense:    d.driverLicense    ?? "",
      passportLicense:  d.passportLicense  ?? "",
      carBrand:         d.carBrand         ?? "",
      carModel:         d.carModel         ?? "",
      carColor:         d.carColor         ?? "",
      carNumber:        d.carNumber        ?? "",
      status:           "pending",
      driverStatus:     "offline",
      photos: {
        passport:      d.photoPassport       ?? "",
        driverLicense: d.photoDriverLicense  ?? "",
        license:       d.photoLicense        ?? "",
        techPassport:  d.photoTechPassport   ?? "",
        carFront:      d.photoCarFront       ?? "",
        carBack:       d.photoCarBack        ?? "",
        carInterior:   d.photoCarInterior    ?? "",
      },
      completedTrips: 0, cancelledTrips: 0, missedOrders: 0,
      totalEarnings: 0,  totalCommission: 0,
      registeredAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    await driverRef.set(driverDoc);

    await getDb().collection("taxiAuditLog").add({
      action: "driver_registered",
      driverId: telegramId,
      driverName: `${driverDoc.firstName} ${driverDoc.lastName}`,
      details: `Водитель зарегистрировался: ${driverDoc.firstName} ${driverDoc.lastName} (авто: ${driverDoc.carBrand} ${driverDoc.carModel}, ${driverDoc.carNumber})`,
      timestamp: Date.now(),
    });

    await sendTaxiMessage(
      chatId,
      `✅ <b>Регистрация завершена!</b>\n\n` +
      `Ваша заявка принята и находится на проверке.\n` +
      `Вы получите уведомление после рассмотрения.\n\n` +
      `👤 ${driverDoc.firstName} ${driverDoc.lastName}\n` +
      `🚗 ${driverDoc.carBrand} ${driverDoc.carModel} — ${driverDoc.carNumber}`,
    );

    console.log(`[TaxiReg] Driver registered: ${driverDoc.firstName} ${driverDoc.lastName} (tgId=${telegramId})`);
  }
}



// ─── Process a single callback_query ───────────────────────────────────────

async function processTaxiCallbackQuery(cq: any): Promise<void> {
  const callbackQueryId: string = cq.id;
  const callbackData: string    = cq.data ?? "";
  const from                    = cq.from ?? {};

  if (!callbackData.startsWith("accept_taxi:")) return;

  const orderId    = callbackData.replace("accept_taxi:", "");
  const driverTgId = String(from.id ?? "");
  const driverName =
    [from.first_name, from.last_name].filter(Boolean).join(" ").trim() ||
    from.username ||
    "Водитель";

  // ── Only registered & approved drivers can accept orders ──
  const driverSnap = await getDb().collection("taxiDrivers").doc(driverTgId).get();

  if (!driverSnap.exists) {
    await answerCallbackQuery(
      callbackQueryId,
      "❌ Вы не зарегистрированы в ZaKi Taxi. Свяжитесь с администратором.",
      true,
    );
    return;
  }

  const driverData = driverSnap.data() as TaxiDriverDoc;

  if (driverData.status !== "approved") {
    const msgs: Record<string, string> = {
      pending:  "⏳ Ваша заявка ещё на проверке. Ожидайте одобрения.",
      rejected: "❌ Ваша заявка отклонена.",
      blocked:  "🚫 Ваш аккаунт заблокирован.",
    };
    await answerCallbackQuery(
      callbackQueryId,
      msgs[driverData.status] ?? "❌ Вы не одобрены как водитель.",
      true,
    );
    return;
  }

  if (driverData.driverStatus === "offline") {
    await answerCallbackQuery(callbackQueryId, "❌ Вы офлайн. Перейдите в онлайн для принятия заказов.", true);
    return;
  }

  // Allow up to 3 simultaneous active orders
  const activeOrdersSnap = await getDb().collection("taxi_orders")
    .where("driverTelegramId", "==", driverTgId)
    .where("status", "==", "accepted")
    .get();
  if (activeOrdersSnap.size >= 3) {
    await answerCallbackQuery(callbackQueryId, `❌ У вас уже ${activeOrdersSnap.size} активных заказа. Завершите один перед принятием нового.`, true);
    return;
  }

  // Collect driver car info for SMS
  const driverPhone    = driverData.phone      ?? "";
  const driverCarBrand = driverData.carBrand   ?? "";
  const driverCarModel = driverData.carModel   ?? "";
  const driverCarColor = driverData.carColor   ?? "";
  const driverCarNumber = driverData.carNumber ?? "";

  const orderRef = getDb().collection("taxi_orders").doc(orderId);

  try {
    const txResult = await getDb().runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { ok: false, reason: "not_found" as const };

      const data = snap.data() as TaxiOrderDoc;
      if (data.status !== "waiting") {
        return { ok: false, reason: "already_accepted" as const, driverName: data.driverName };
      }

      const now = Date.now();
      tx.update(orderRef, {
        status: "accepted",
        driverTelegramId: driverTgId,
        driverName,
        driverPhone,
        driverCarBrand,
        driverCarModel,
        driverCarColor,
        driverCarNumber,
        acceptedAt: now,
      });
      return { ok: true, data, now };
    });

    if (!txResult.ok) {
      const msg = txResult.reason === "already_accepted"
        ? "❌ Заказ уже принят другим водителем."
        : "❌ Заказ не найден.";
      await answerCallbackQuery(callbackQueryId, msg, true);
      return;
    }

    const { data: orderData, now } = txResult as { ok: true; data: TaxiOrderDoc; now: number };

    const timeStr     = toTjTimeStr(now);
    const destDisplay = orderData.destination || "Не указано";

    // Show phone number ONLY to the accepting driver via popup (always works)
    await answerCallbackQuery(
      callbackQueryId,
      `✅ Заказ №${orderData.orderNumber} принят!\n📞 Клиент: ${orderData.customerPhone}\n📍 Откуда: ${orderData.pickup}`,
      true, // show_alert — popup visible only to this driver
    );

    // Update driver status and increment active order count
    await getDb().collection("taxiDrivers").doc(driverTgId).update({
      driverStatus: "on_order",
      activeOrderCount: admin.firestore.FieldValue.increment(1),
      lastActiveAt: Date.now(),
    });

    // Group message — phone hidden, only driver knows
    const updatedText =
      `🚖 <b>Заказ №${orderData.orderNumber}</b>  |  ✅ Принят  |  🕒 ${timeStr}\n\n` +
      `📍 <b>Откуда:</b> ${orderData.pickup}\n` +
      `📍 <b>Куда:</b> ${destDisplay}\n\n` +
      `👤 <b>Водитель:</b> ${driverName}`;

    if (orderData.telegramMessageId) {
      await editTaxiTelegramMessage(orderData.telegramMessageId, updatedText);
    }

    // Private DM to driver with client phone (best-effort, may fail if driver hasn't started bot)
    const dmText =
      `✅ <b>Вы приняли заказ №${orderData.orderNumber}</b>\n\n` +
      `📞 <b>Номер клиента:</b> <code>${orderData.customerPhone}</code>\n` +
      `📍 <b>Откуда:</b> ${orderData.pickup}\n` +
      `📍 <b>Куда:</b> ${destDisplay}\n\n` +
      `🕒 ${timeStr}`;
    try {
      const dmRes = await fetch(`https://api.telegram.org/bot${TAXI_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: driverTgId, text: dmText, parse_mode: "HTML" }),
      });
      if (!dmRes.ok) {
        const dmErr = await dmRes.text().catch(() => "");
        console.warn(`[Taxi] DM to driver ${driverTgId} failed (${dmRes.status}): ${dmErr}`);
      } else {
        console.log(`[Taxi] DM sent to driver ${driverTgId}`);
      }
    } catch (dmE) {
      console.warn(`[Taxi] DM to driver ${driverTgId} error:`, dmE);
    }

    // SMS with full car info
    let smsText = `ZaKi Taxi\nВаш водитель уже назначен.\n`;
    smsText += `Водитель: ${driverName}\n`;
    if (driverPhone)     smsText += `Телефон: ${driverPhone}\n`;
    if (driverCarBrand)  smsText += `Автомобиль: ${driverCarBrand} ${driverCarModel}\n`;
    if (driverCarColor)  smsText += `Цвет: ${driverCarColor}\n`;
    if (driverCarNumber) smsText += `Госномер: ${driverCarNumber}\n`;
    smsText += `Спасибо, что выбрали ZaKi Taxi.`;

    await sendTaxiSms(orderData.customerPhone, smsText);

    // Audit
    await getDb().collection("taxiAuditLog").add({
      action: "order_accepted",
      driverId: driverTgId,
      driverName,
      orderId,
      details: `Заказ №${orderData.orderNumber} принят водителем "${driverName}"`,
      timestamp: Date.now(),
    });

    console.log(`[Taxi] Order №${orderData.orderNumber} accepted by "${driverName}" (tgId=${driverTgId})`);
  } catch (e) {
    console.error("[Taxi] processTaxiCallbackQuery error:", e);
    await answerCallbackQuery(callbackQueryId, "Ошибка сервера. Попробуйте ещё раз.", true);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CALLABLE: createTaxiOrder
//  Called by the dispatcher in the admin panel.
// ═══════════════════════════════════════════════════════════════════════════════

export const createTaxiOrder = functions.https.onCall(async (data) => {
  const { adminId, customerPhone, pickup, destination } = data as {
    adminId: string;
    customerPhone: string;
    pickup: string;
    destination?: string;
  };

  if (!customerPhone?.trim() || !pickup?.trim()) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "customerPhone and pickup are required",
    );
  }

  await verifyTaxiAdmin(adminId);

  const orderNumber = await getNextOrderNumber();
  const orderRef = getDb().collection("taxi_orders").doc();
  const now = Date.now();
  const timeStr = toTjTimeStr(now);

  const orderDoc: TaxiOrderDoc = {
    orderNumber,
    customerPhone: customerPhone.trim(),
    pickup:        pickup.trim(),
    destination:   destination?.trim() || "",
    status:        "waiting",
    driverTelegramId: null,
    driverName:    null,
    driverPhone:   null,
    driverCarBrand:  null,
    driverCarModel:  null,
    driverCarColor:  null,
    driverCarNumber: null,
    telegramMessageId: null,
    createdAt:     now,
    acceptedAt:    null,
  };

  await orderRef.set(orderDoc);

  // Build Telegram notification text
  const destDisplay = orderDoc.destination || "Не указано";
  const tgText =
    `🚖 <b>Новый заказ №${orderNumber}</b>  |  ⏰ ${timeStr}\n\n` +
    `📍 <b>Откуда:</b> ${orderDoc.pickup}\n` +
    `📍 <b>Куда:</b> ${destDisplay}`;

  const messageId = await sendTaxiTelegramWithButton(tgText, orderRef.id);
  if (messageId !== null) {
    await orderRef.update({ telegramMessageId: messageId });
  }

  console.log(`[Taxi] Order №${orderNumber} created (id=${orderRef.id}), tgMsgId=${messageId}`);

  return { orderId: orderRef.id, orderNumber };
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SCHEDULED: taxiTelegramPoller
//  Runs every minute. Calls Telegram getUpdates, processes callback_queries.
//  No webhook setup required — works automatically after deploy.
//
//  Offset is persisted in Firestore: settings/taxiTelegramOffset { offset: number }
// ═══════════════════════════════════════════════════════════════════════════════

export const taxiTelegramPoller = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    const db         = getDb();
    const offsetRef  = db.collection("settings").doc("taxiTelegramOffset");
    const offsetSnap = await offsetRef.get();
    const offset: number = offsetSnap.exists ? (offsetSnap.data()!.offset ?? 0) : 0;

    const updates = await getTelegramUpdates(offset);

    if (updates.length === 0) {
      console.log("[Taxi Poller] No new updates.");
      return null;
    }

    console.log(`[Taxi Poller] ${updates.length} update(s) received.`);

    // Process sequentially to avoid race conditions on the same order
    for (const update of updates) {
      // Route registration-related updates first
      const isRegistrationUpdate =
        update.message?.text === "/start" ||
        update.callback_query?.data === "register_driver" ||
        (update.message && await isActiveRegistration(String(update.message?.from?.id ?? "")));

      if (isRegistrationUpdate) {
        await handleTaxiBotUpdate(update);
      } else if (update.callback_query) {
        await processTaxiCallbackQuery(update.callback_query);
      }
    }

    // Advance offset so processed updates are never re-delivered
    const lastUpdateId: number = updates[updates.length - 1].update_id;
    await offsetRef.set({ offset: lastUpdateId + 1 }, { merge: true });

    return null;
  });
