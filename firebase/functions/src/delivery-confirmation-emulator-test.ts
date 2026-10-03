import * as assert from "assert";
import * as admin from "firebase-admin";
import {confirmationSmsSuffix} from "./delivery-confirmation";
import {JPEG_FIXTURE} from "./delivery-confirmation-self-test";

async function main(): Promise<void> {
  const projectId = process.env.GCLOUD_PROJECT || "";
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && projectId.startsWith("demo-"), "This test must run ONLY in a demo-project Firestore emulator");
  // No real SMS or external integrations may run in this test.
  process.env.PAYOM_API_TOKEN = "";
  process.env.ZAKI_RASHOD_COMMISSION_URL = "";
  const api = await import("./index");
  const invoke = (fn: unknown, data: unknown) => (fn as {run: (data: unknown, context: unknown) => Promise<any>}).run(data, {});
  const db = admin.firestore();
  await db.doc("users/admin").set({role: "ADMIN"});
  await db.doc("users/courier").set({role: "COURIER", name: "Test Courier", isBlocked: false, isOnShift: true, balance: 100, commissionPercent: 10});
  await db.doc("tariffs/default").set({baseCost: 10, costPerKm: 2, fixedTypes: {coal: 10}});
  const create = async (code: boolean, photo: boolean, assigned = true) => {
    const result = await invoke(api.adminCreateMarketplaceDelivery, {
      adminId: "admin", clientPhone: "992900000001", pickup: {latitude: 38.56, longitude: 68.77},
      courierId: assigned ? "courier" : null, deliveryType: "coal", requiresRecipientCode: code, requiresDeliveryPhoto: photo,
    });
    const ref = db.doc(`deliveries/${result.deliveryId}`);
    const secretRef = db.doc(`deliveryConfirmations/${result.deliveryId}`);
    assert.strictEqual((await ref.get()).data()?.requiresRecipientCode, code);
    assert.strictEqual((await secretRef.get()).exists, code || photo);
    assert.strictEqual((await ref.get()).data()?.recipientCode, undefined);
    await invoke(api.acceptMarketplaceDelivery, {deliveryId: result.deliveryId, courierId: "courier"});
    return {id: result.deliveryId, ref, secretRef};
  };
  const complete = (id: string, extras = {}) => invoke(api.completeDelivery, {deliveryId: id, courierId: "courier", route: [], ...extras});
  const protectedOrder = await create(true, true);
  const secret = (await protectedOrder.secretRef.get()).data()!;
  assert.match(secret.recipientCode, /^\d{6}$/);
  assert.ok((await confirmationSmsSuffix(db, protectedOrder.id, (await protectedOrder.ref.get()).data()!)).includes(secret.recipientCode));
  await assert.rejects(complete(protectedOrder.id));
  await assert.rejects(complete(protectedOrder.id, {recipientCode: secret.recipientCode}));
  await assert.rejects(complete(protectedOrder.id, {recipientCode: "000000", confirmationPhotoBase64: JPEG_FIXTURE}));
  for (let attempt = 2; attempt <= 5; attempt++) {
    await assert.rejects(complete(protectedOrder.id, {recipientCode: "000000", confirmationPhotoBase64: JPEG_FIXTURE}));
  }
  await assert.rejects(complete(protectedOrder.id, {recipientCode: secret.recipientCode, confirmationPhotoBase64: JPEG_FIXTURE}));
  assert.strictEqual((await protectedOrder.secretRef.get()).data()?.failedAttempts, 5);
  await protectedOrder.secretRef.update({lockedUntil: Date.now() - 1});
  await assert.rejects(invoke(api.resendDeliveryConfirmationCode, {adminId: "admin", deliveryId: protectedOrder.id}),
    (error: any) => error.code === "unavailable");
  await assert.rejects(invoke(api.resendDeliveryConfirmationCode, {adminId: "admin", deliveryId: protectedOrder.id}),
    (error: any) => error.code === "resource-exhausted");
  await assert.rejects(invoke(api.adminCompleteDelivery, {adminId: "admin", deliveryId: protectedOrder.id}));
  await assert.rejects(invoke(api.adminSetDeliveryStatus, {adminId: "admin", deliveryId: protectedOrder.id, status: "COMPLETED"}));
  await assert.rejects(invoke(api.completeDelivery, {deliveryId: protectedOrder.id, courierId: "other", recipientCode: secret.recipientCode, confirmationPhotoBase64: JPEG_FIXTURE}));
  assert.strictEqual((await db.doc("users/courier").get()).data()?.balance, 100);
  assert.strictEqual((await protectedOrder.ref.get()).data()?.status, "IN_PROGRESS");
  assert.strictEqual((await db.collection("transactions").get()).size, 0);

  // Guest REST calls exercise the actual rules, whereas the Admin SDK seeds
  // fixtures and bypasses rules just like deployed Functions do.
  const restBase = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/`;
  const guest = async (path: string, method = "GET", fields?: Record<string, unknown>) => {
    const response = await fetch(restBase + path, {method, headers: {"Content-Type": "application/json"},
      ...(fields ? {body: JSON.stringify({fields})} : {})});
    return response.status;
  };
  assert.strictEqual(await guest(`deliveryConfirmations/${protectedOrder.id}`), 403);
  assert.strictEqual(await guest(`deliveryConfirmations/${protectedOrder.id}`, "PATCH", {recipientCode: {stringValue: "000000"}}), 403);
  assert.strictEqual(await guest(`deliveries/${protectedOrder.id}?updateMask.fieldPaths=status`, "PATCH", {status: {stringValue: "COMPLETED"}}), 403);
  assert.strictEqual(await guest(`deliveries/${protectedOrder.id}?updateMask.fieldPaths=requiresRecipientCode`, "PATCH", {requiresRecipientCode: {booleanValue: false}}), 403);
  assert.strictEqual(await guest(`deliveries/${protectedOrder.id}?updateMask.fieldPaths=deliveryPhotoSubmitted`, "PATCH", {deliveryPhotoSubmitted: {booleanValue: true}}), 403);
  assert.strictEqual(await guest(`deliveries/${protectedOrder.id}?updateMask.fieldPaths=adminOrderStage`, "PATCH", {adminOrderStage: {stringValue: "COMPLETED"}}), 403);
  assert.strictEqual(await guest(`deliveries/${protectedOrder.id}?updateMask.fieldPaths=distanceMeters`, "PATCH", {distanceMeters: {doubleValue: 100}}), 200);
  assert.strictEqual(await guest("deliveries/forged-proof", "PATCH", {requiresRecipientCode: {booleanValue: true}}), 403);
  assert.strictEqual(await guest("deliveries/legacy", "PATCH", {status: {stringValue: "IN_PROGRESS"}}), 200);

  // Parallel submissions and a subsequent retry must charge exactly once.
  await Promise.allSettled([complete(protectedOrder.id, {recipientCode: secret.recipientCode, confirmationPhotoBase64: JPEG_FIXTURE}),
    complete(protectedOrder.id, {recipientCode: secret.recipientCode, confirmationPhotoBase64: JPEG_FIXTURE})]);
  const delivered = (await protectedOrder.ref.get()).data()!;
  assert.strictEqual(delivered.status, "COMPLETED");
  assert.strictEqual(delivered.recipientCodeVerified, true);
  assert.strictEqual(delivered.deliveryPhotoSubmitted, true);
  const balance = (await db.doc("users/courier").get()).data()?.balance;
  assert.strictEqual(balance, 99);
  const retry = await complete(protectedOrder.id);
  assert.strictEqual(retry.recipientCode, undefined);
  assert.strictEqual(retry.photoBase64, undefined);
  assert.strictEqual((await db.doc("users/courier").get()).data()?.balance, balance);
  assert.strictEqual((await db.collection("transactions").where("deliveryId", "==", protectedOrder.id).get()).size, 1);
  const photo = await invoke(api.getDeliveryConfirmationPhoto, {adminId: "admin", deliveryId: protectedOrder.id});
  assert.strictEqual(photo.photoDataUrl, `data:image/jpeg;base64,${JPEG_FIXTURE}`);
  await assert.rejects(invoke(api.getDeliveryConfirmationPhoto, {adminId: "courier", deliveryId: protectedOrder.id}));
  assert.strictEqual(await guest(`deliveryConfirmations/${protectedOrder.id}`), 403);
  assert.ok((await confirmationSmsSuffix(db, protectedOrder.id, delivered, true)).includes(secret.recipientCode));

  const codeOnly = await create(true, false, false);
  const codeSecret = (await codeOnly.secretRef.get()).data()!;
  await complete(codeOnly.id, {recipientCode: codeSecret.recipientCode});
  assert.strictEqual((await codeOnly.ref.get()).data()?.deliveryPhotoSubmitted, false);
  const photoOnly = await create(false, true);
  await assert.rejects(complete(photoOnly.id));
  await complete(photoOnly.id, {confirmationPhotoBase64: JPEG_FIXTURE});
  const ordinary = await create(false, false, false);
  await complete(ordinary.id);
  assert.strictEqual((await ordinary.ref.get()).data()?.status, "COMPLETED");
  console.log("Confirmation endpoint, commission retry and Firestore rules emulator checks passed");
  await admin.app().delete();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
