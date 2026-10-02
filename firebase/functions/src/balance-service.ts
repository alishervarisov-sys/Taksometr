import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

export const LOW_BALANCE_THRESHOLD = 10;

export function parseTopUpAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    throw new functions.https.HttpsError("invalid-argument", "Укажите сумму от 0.01 до 100000 сомони, не более двух знаков после запятой");
  }
  return Math.round(amount * 100) / 100;
}

export function balanceAlertAction(before: number | undefined, after: number, active: boolean): "WARN" | "CLEAR" | "NONE" {
  if (after > LOW_BALANCE_THRESHOLD || (before !== undefined && after > before)) return "CLEAR";
  if (after <= LOW_BALANCE_THRESHOLD && !active) return "WARN";
  return "NONE";
}

export function createBalanceService(db: admin.firestore.Firestore, verifyAdmin: (id: string) => Promise<void>) {
  const validId = (value: unknown) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
      throw new functions.https.HttpsError("invalid-argument", "Некорректный идентификатор");
    }
    return value;
  };

  async function requestTopUp(data: any) {
    const courierId = validId(data?.courierId);
    const requestId = validId(data?.requestId);
    const amount = parseTopUpAmount(data?.amount);
    const courierRef = db.collection("users").doc(courierId);
    const requestRef = db.collection("balanceTopUpRequests").doc(requestId);
    return db.runTransaction(async tx => {
      const courier = await tx.get(courierRef);
      const existing = await tx.get(requestRef);
      if (!courier.exists || courier.data()?.role !== "COURIER" || courier.data()?.isBlocked) {
        throw new functions.https.HttpsError("permission-denied", "Аккаунт курьера недоступен");
      }
      if (existing.exists) {
        if (existing.get("courierId") !== courierId || existing.get("amount") !== amount) {
          throw new functions.https.HttpsError("already-exists", "Идентификатор заявки уже использован");
        }
        return {requestId, amount, status: existing.get("status")};
      }
      const pendingId = courier.get("pendingTopUpRequestId");
      if (typeof pendingId === "string" && pendingId) {
        const pending = await tx.get(db.collection("balanceTopUpRequests").doc(pendingId));
        if (pending.exists && pending.get("status") === "PENDING") {
          return {requestId: pendingId, amount: pending.get("amount"), status: "PENDING"};
        }
      }
      tx.set(requestRef, {
        courierId, courierName: courier.get("name") || "", courierPhone: courier.get("phone") || "",
        amount, status: "PENDING", createdAt: Date.now(),
      });
      tx.update(courierRef, {pendingTopUpRequestId: requestId, pendingTopUpAmount: amount});
      return {requestId, amount, status: "PENDING"};
    });
  }

  async function reviewTopUp(data: any) {
    await verifyAdmin(data?.adminId);
    const requestId = validId(data?.requestId);
    const decision = data?.decision;
    const paymentStatus = data?.paymentStatus;
    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new functions.https.HttpsError("invalid-argument", "Выберите одобрение или отказ");
    }
    if (decision === "APPROVE" && paymentStatus !== "PAID" && paymentStatus !== "DEBT") {
      throw new functions.https.HttpsError("invalid-argument", "Выберите статус: оплачено или долг");
    }
    const requestRef = db.collection("balanceTopUpRequests").doc(requestId);
    const ledgerRef = db.collection("transactions").doc(`topup_request_${requestId}`);
    return db.runTransaction(async tx => {
      const request = await tx.get(requestRef);
      if (!request.exists) throw new functions.https.HttpsError("not-found", "Заявка не найдена");
      const targetStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
      if (request.get("status") !== "PENDING") {
        if (request.get("status") === targetStatus) return {status: targetStatus, alreadyReviewed: true};
        throw new functions.https.HttpsError("failed-precondition", "Заявка уже обработана");
      }
      const courierId = request.get("courierId");
      const courierRef = db.collection("users").doc(courierId);
      const courier = await tx.get(courierRef);
      const ledger = await tx.get(ledgerRef);
      if (!courier.exists || courier.get("role") !== "COURIER") {
        throw new functions.https.HttpsError("not-found", "Курьер не найден");
      }
      const amount = parseTopUpAmount(request.get("amount"));
      const now = Date.now();
      const updates: Record<string, unknown> = {};
      if (courier.get("pendingTopUpRequestId") === requestId) {
        updates.pendingTopUpRequestId = "";
        updates.pendingTopUpAmount = 0;
      }
      let newBalance = Number(courier.get("balance") || 0);
      if (!Number.isFinite(newBalance)) throw new functions.https.HttpsError("failed-precondition", "Некорректный баланс курьера");
      if (decision === "APPROVE") {
        if (ledger.exists) throw new functions.https.HttpsError("failed-precondition", "Пополнение уже начислено");
        newBalance = Math.round((newBalance + amount) * 100) / 100;
        updates.balance = newBalance;
        updates.lowBalanceNotificationActive = false;
        tx.set(ledgerRef, {
          courierId, courierName: courier.get("name") || "", type: "TOP_UP", amount, balanceAfter: newBalance,
          description: "Пополнение по заявке курьера", adminId: data.adminId, topUpRequestId: requestId,
          paymentStatus, paymentStatusUpdatedAt: now, paymentStatusUpdatedBy: data.adminId,
          paymentStatusHistory: [{from: null, to: paymentStatus, changedAt: now, adminId: data.adminId}],
          ...(paymentStatus === "PAID" ? {paidAt: now} : {}), createdAt: now,
        });
      }
      if (Object.keys(updates).length) tx.update(courierRef, updates);
      tx.update(requestRef, {
        status: targetStatus, reviewedAt: now, reviewedBy: data.adminId,
        ...(decision === "APPROVE" ? {paymentStatus, transactionId: ledgerRef.id, balanceAfter: newBalance} : {}),
      });
      tx.set(db.collection("courierNotifications").doc(`topup_result_${requestId}`), {
        courierId, type: decision === "APPROVE" ? "BALANCE_TOP_UP" : "TOP_UP_REJECTED",
        title: decision === "APPROVE" ? "Баланс пополнен" : "Заявка на пополнение отклонена",
        body: decision === "APPROVE" ? `+${amount} сомони. Баланс: ${newBalance} сомони. ${paymentStatus === "DEBT" ? "Начислено в долг" : "Оплачено"}.` : "Обратитесь к администратору или отправьте новую заявку.",
        payload: {courierId, requestId, newBalance: String(newBalance)}, status: "PENDING", attempts: 0, createdAt: now,
      });
      return {status: targetStatus, newBalance, transactionId: decision === "APPROVE" ? ledgerRef.id : null};
    });
  }

  async function handleBalanceChange(courierId: string, beforeBalance: number | undefined, afterBalance: number, eventId: string, eventAt: number) {
    if (!Number.isFinite(afterBalance) || beforeBalance === afterBalance) return;
    const courierRef = db.collection("users").doc(courierId);
    await db.runTransaction(async tx => {
      const courier = await tx.get(courierRef);
      // Firestore events can arrive out of order. Never let an old debit
      // recreate a warning after an administrator has credited the balance.
      if (!courier.exists || courier.get("role") !== "COURIER" ||
          Number(courier.get("balance")) !== afterBalance || Number(courier.get("lowBalanceHandledAt") || 0) >= eventAt) return;
      const active = courier.get("lowBalanceNotificationActive") === true;
      const action = balanceAlertAction(beforeBalance, afterBalance, active);
      const notificationId = `balance_${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      tx.update(courierRef, {
        lowBalanceHandledAt: eventAt,
        ...(action === "WARN" ? {lowBalanceNotificationActive: true, lowBalanceNotificationId: notificationId} : {}),
        ...(action === "CLEAR" ? {lowBalanceNotificationActive: false} : {}),
      });
      if (action === "WARN" || action === "CLEAR") {
        tx.set(db.collection("courierNotifications").doc(notificationId), {
          courierId, type: action === "WARN" ? "LOW_BALANCE" : "BALANCE_RECOVERED",
          title: action === "WARN" ? "Баланс заканчивается" : "Баланс обновлён",
          body: action === "WARN" ? `На балансе ${afterBalance} сомони. Пополните баланс.` : "Предупреждение о низком балансе снято.",
          payload: {courierId, notificationId, newBalance: String(afterBalance), balanceEventAt: String(eventAt)},
          status: "PENDING", attempts: 0, createdAt: Date.now(),
        });
      }
    });
  }

  return {requestTopUp, reviewTopUp, handleBalanceChange};
}
