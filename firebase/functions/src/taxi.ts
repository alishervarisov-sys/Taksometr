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

/** Replace the taxi order message text (removes the inline button). */
async function editTaxiTelegramMessage(messageId: number, newText: string): Promise<void> {
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
          // No reply_markup → button disappears
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
          timeout: 0,                           // instant return
          allowed_updates: ["callback_query"],  // only what we need
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
      tx.update(orderRef, { status: "accepted", driverTelegramId: driverTgId, driverName, acceptedAt: now });
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
    await answerCallbackQuery(callbackQueryId, "✅ Вы приняли заказ!");

    const timeStr     = toTjTimeStr(now);
    const destDisplay = orderData.destination || "Не указано";
    const updatedText =
      `🚖 <b>Заказ №${orderData.orderNumber}</b>\n\n` +
      `📞 <b>Клиент</b>\n${orderData.customerPhone}\n\n` +
      `📍 <b>Откуда</b>\n${orderData.pickup}\n\n` +
      `📍 <b>Куда</b>\n${destDisplay}\n\n` +
      `✅ <b>Заказ принят</b>\n` +
      `👤 <b>Водитель</b>\n${driverName}\n` +
      `🕒 ${timeStr}`;

    if (orderData.telegramMessageId) {
      await editTaxiTelegramMessage(orderData.telegramMessageId, updatedText);
    }

    await sendTaxiSms(
      orderData.customerPhone,
      `ZaKi Taxi\nВаш водитель уже назначен.\nВодитель: ${driverName}\nСпасибо, что выбрали ZaKi Taxi.`,
    );

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
    pickup: pickup.trim(),
    destination: destination?.trim() || "",
    status: "waiting",
    driverTelegramId: null,
    driverName: null,
    telegramMessageId: null,
    createdAt: now,
    acceptedAt: null,
  };

  await orderRef.set(orderDoc);

  // Build Telegram notification text
  const destDisplay = orderDoc.destination || "Не указано";
  const tgText =
    `🚖 <b>Новый заказ</b>\n\n` +
    `🆔 №${orderNumber}\n\n` +
    `📞 <b>Клиент</b>\n${orderDoc.customerPhone}\n\n` +
    `📍 <b>Откуда</b>\n${orderDoc.pickup}\n\n` +
    `📍 <b>Куда</b>\n${destDisplay}\n\n` +
    `⏰ <b>Время</b>\n${timeStr}`;

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
      if (update.callback_query) {
        await processTaxiCallbackQuery(update.callback_query);
      }
    }

    // Advance offset so processed updates are never re-delivered
    const lastUpdateId: number = updates[updates.length - 1].update_id;
    await offsetRef.set({ offset: lastUpdateId + 1 }, { merge: true });

    return null;
  });
