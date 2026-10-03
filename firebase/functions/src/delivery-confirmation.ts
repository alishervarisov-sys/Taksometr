import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {randomInt} from "crypto";

export const MAX_CONFIRMATION_PHOTO_BYTES = 300 * 1024;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function confirmationOptions(data: Record<string, unknown>): {
  requiresRecipientCode: boolean; requiresDeliveryPhoto: boolean;
} {
  for (const key of ["requiresRecipientCode", "requiresDeliveryPhoto"]) {
    if (data[key] !== undefined && typeof data[key] !== "boolean") {
      throw new functions.https.HttpsError("invalid-argument", "Настройки подтверждения должны быть включены или выключены");
    }
  }
  return {requiresRecipientCode: data.requiresRecipientCode === true, requiresDeliveryPhoto: data.requiresDeliveryPhoto === true};
}

export function parseConfirmationPhoto(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_CONFIRMATION_PHOTO_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new functions.https.HttpsError("invalid-argument", "Сделайте фото вручения (JPEG, до 300 КБ)");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 32 || bytes.length > MAX_CONFIRMATION_PHOTO_BYTES || bytes.toString("base64") !== value ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new functions.https.HttpsError("invalid-argument", "Некорректное фото вручения. Сделайте новый снимок");
  }
  // Require an actual JPEG frame and scan header, not just a JPEG prefix on
  // arbitrary uploaded bytes. Android supplies a resized, re-encoded image.
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset++;
    if (offset + 4 > bytes.length) break;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8) break;
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      hasFrame = width > 0 && height > 0 && width <= 2048 && height <= 2048;
    }
    if (marker === 0xda) { hasScan = length >= 6; break; }
    offset += 2 + length;
  }
  if (!hasFrame || !hasScan) {
    throw new functions.https.HttpsError("invalid-argument", "Некорректное фото вручения. Сделайте новый снимок");
  }
  return value;
}

export function checkRecipientCode(secret: Record<string, any>, input: unknown, now: number): {
  error?: string; updates: Record<string, number>;
} {
  if (Number(secret.lockedUntil || 0) > now) {
    return {error: "Слишком много неверных кодов. Повторите через 5 минут", updates: {}};
  }
  if (typeof secret.recipientCode !== "string" || !/^\d{6}$/.test(secret.recipientCode)) {
    return {error: "Код подтверждения отсутствует. Обратитесь к диспетчеру", updates: {}};
  }
  if (typeof input !== "string" || !/^\d{6}$/.test(input)) {
    return {error: "Введите шестизначный код из SMS получателя", updates: {}};
  }
  if (input !== secret.recipientCode) {
    const attempts = Number(secret.lockedUntil || 0) > 0 ? 1 : Number(secret.failedAttempts || 0) + 1;
    return {
      error: attempts >= MAX_ATTEMPTS ? "Слишком много неверных кодов. Повторите через 5 минут" : "Неверный код получателя",
      updates: {failedAttempts: attempts, lockedUntil: attempts >= MAX_ATTEMPTS ? now + LOCK_MS : 0},
    };
  }
  return {updates: {failedAttempts: 0, lockedUntil: 0}};
}

export async function createDeliveryWithConfirmation(
  db: admin.firestore.Firestore, ref: admin.firestore.DocumentReference, delivery: admin.firestore.DocumentData,
): Promise<void> {
  const batch = db.batch();
  batch.set(ref, delivery);
  if (delivery.requiresRecipientCode || delivery.requiresDeliveryPhoto) {
    batch.set(db.collection("deliveryConfirmations").doc(ref.id), {
      ...(delivery.requiresRecipientCode ? {recipientCode: String(randomInt(100000, 1000000))} : {}),
      failedAttempts: 0, lockedUntil: 0, createdAt: Date.now(),
    });
  }
  await batch.commit();
}

export async function confirmationSmsSuffix(
  db: admin.firestore.Firestore, deliveryId: string, delivery: admin.firestore.DocumentData, completed = false,
): Promise<string> {
  if (!delivery.requiresRecipientCode) return "";
  const secret = (await db.collection("deliveryConfirmations").doc(deliveryId).get()).data();
  if (!secret?.recipientCode) throw new functions.https.HttpsError("failed-precondition", "Код подтверждения отсутствует");
  return ` Рамзи тасдиқи супоридан: ${secret.recipientCode}.` +
    (completed ? "" : " Рамзро ба курьер танҳо ҳангоми гирифтани фармоиш гӯед.");
}

// Run before charging commission or changing delivery status. Keep secrets and
// photo bytes out of the publicly readable delivery document and callable reply.
export async function verifyDeliveryConfirmation(
  db: admin.firestore.Firestore, deliveryId: string, delivery: admin.firestore.DocumentData, input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!delivery.requiresRecipientCode && !delivery.requiresDeliveryPhoto) return {};
  const photoBase64 = delivery.requiresDeliveryPhoto ? parseConfirmationPhoto(input.confirmationPhotoBase64) : null;
  const secretRef = db.collection("deliveryConfirmations").doc(deliveryId);
  const now = Date.now();
  const error = await db.runTransaction(async tx => {
    const current = await tx.get(db.collection("deliveries").doc(deliveryId));
    const secret = await tx.get(secretRef);
    if (current.data()?.status !== "IN_PROGRESS" || current.data()?.courierId !== delivery.courierId ||
        current.data()?.requiresRecipientCode !== delivery.requiresRecipientCode ||
        current.data()?.requiresDeliveryPhoto !== delivery.requiresDeliveryPhoto || current.data()?.clientPhone !== delivery.clientPhone) {
      return "Заказ изменён. Обновите экран";
    }
    if (delivery.requiresRecipientCode) {
      const checked = checkRecipientCode(secret.data() || {}, input.recipientCode, now);
      if (Object.keys(checked.updates).length) tx.set(secretRef, checked.updates, {merge: true});
      if (checked.error) return checked.error;
    }
    tx.set(secretRef, {
      ...(photoBase64 ? {photoBase64} : {}), verifiedByCourierId: delivery.courierId, verifiedAt: now,
    }, {merge: true});
    return null;
  });
  if (error) throw new functions.https.HttpsError("failed-precondition", error);
  return {recipientCodeVerified: delivery.requiresRecipientCode === true,
    deliveryPhotoSubmitted: delivery.requiresDeliveryPhoto === true, deliveryConfirmedAt: now};
}

export function requireConfirmedDelivery(delivery: admin.firestore.DocumentData): void {
  if ((delivery.requiresRecipientCode && !delivery.recipientCodeVerified) ||
      (delivery.requiresDeliveryPhoto && !delivery.deliveryPhotoSubmitted)) {
    throw new functions.https.HttpsError("failed-precondition", "Курьер должен подтвердить вручение кодом и/или фото в приложении");
  }
}
