import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import * as crypto from "crypto";

export function createAdminPushService(db: admin.firestore.Firestore, verifyAdmin: (id: string) => Promise<void>) {
  async function getConfig(data: any) {
    await verifyAdmin(data?.adminId);
    const config = await db.collection("settings").doc("webPush").get();
    return {vapidKey: process.env.FIREBASE_WEB_PUSH_VAPID_KEY || config.get("vapidKey") || ""};
  }
  async function saveConfig(data: any) {
    await verifyAdmin(data?.adminId);
    if (data.adminId !== "SUPER_ADMIN") throw new functions.https.HttpsError("permission-denied", "Только суперадминистратор может подключить Web Push");
    const key = data?.vapidKey;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{87,88}$/.test(key) || Buffer.from(key, "base64url").length !== 65) {
      throw new functions.https.HttpsError("invalid-argument", "Укажите публичный ключ Web Push из Firebase");
    }
    await db.collection("settings").doc("webPush").set({vapidKey: key, updatedAt: Date.now(), updatedBy: data.adminId});
    return {success: true};
  }
  async function register(data: any) {
    await verifyAdmin(data?.adminId);
    if (typeof data?.token !== "string" || data.token.length < 20 || data.token.length > 4096) {
      throw new functions.https.HttpsError("invalid-argument", "Некорректный push-токен");
    }
    const ref = db.collection("adminPushTokens").doc(crypto.createHash("sha256").update(data.token).digest("hex"));
    if (data.enabled === false) {
      const current = await ref.get();
      if (current.exists && current.get("adminId") === data.adminId) await ref.delete();
    } else {
      await ref.set({adminId: data.adminId, token: data.token, updatedAt: Date.now()});
    }
    return {success: true};
  }
  async function listRequests(data: any) {
    await verifyAdmin(data?.adminId);
    const requests = await db.collection("balanceTopUpRequests").where("status", "==", "PENDING").orderBy("createdAt", "asc").get();
    return {requests: requests.docs.map(doc => ({id: doc.id, ...doc.data()}))};
  }
  async function notifyRequest(requestId: string) {
    const request = await db.collection("balanceTopUpRequests").doc(requestId).get();
    if (!request.exists || request.get("status") !== "PENDING") return;
    const tokens = await db.collection("adminPushTokens").get();
    let retry = false;
    for (const target of tokens.docs) {
      try {
        await verifyAdmin(target.get("adminId"));
      } catch {
        await target.ref.delete();
        continue;
      }
      try {
        await admin.messaging().send({
          token: target.get("token"),
          data: {
            type: "BALANCE_TOP_UP_REQUEST", requestId, adminId: target.get("adminId"),
            title: "Заявка на пополнение баланса",
            body: `${request.get("courierName") || "Курьер"} просит пополнить баланс на ${request.get("amount")} сомони`,
          },
          webpush: {headers: {Urgency: "high", TTL: "86400"}},
        });
      } catch (error: any) {
        if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error?.code)) {
          await target.ref.delete();
        } else {
          console.error("Admin push failed", error?.code);
          retry = true;
        }
      }
    }
    if (retry) throw new Error("Retry top-up request web push");
  }
  return {getConfig, saveConfig, register, listRequests, notifyRequest};
}
