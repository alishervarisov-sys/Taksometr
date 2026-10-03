import * as assert from "assert";
import {checkRecipientCode, confirmationOptions, MAX_CONFIRMATION_PHOTO_BYTES, parseConfirmationPhoto, requireConfirmedDelivery} from "./delivery-confirmation";

// Minimal frame/scan marker fixture for the upload envelope validator.
export const JPEG_FIXTURE = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3, 4, 5, 0xff, 0xd9,
]).toString("base64");

assert.deepStrictEqual(confirmationOptions({}), {requiresRecipientCode: false, requiresDeliveryPhoto: false});
assert.throws(() => confirmationOptions({requiresRecipientCode: "true"}));
assert.strictEqual(parseConfirmationPhoto(JPEG_FIXTURE), JPEG_FIXTURE);
for (const value of [undefined, "", "hello", "data:image/jpeg;base64," + JPEG_FIXTURE, "/9j/2Q==",
  Buffer.alloc(MAX_CONFIRMATION_PHOTO_BYTES + 1).toString("base64")]) {
  assert.throws(() => parseConfirmationPhoto(value));
}
const now = 1000000;
const secret = {recipientCode: "123456", failedAttempts: 0, lockedUntil: 0};
assert.ok(checkRecipientCode(secret, "12345", now).error);
assert.deepStrictEqual(checkRecipientCode(secret, "123456", now).updates, {failedAttempts: 0, lockedUntil: 0});
for (let attempt = 1; attempt <= 5; attempt++) {
  const result = checkRecipientCode(secret, "000000", now);
  assert.ok(result.error);
  assert.strictEqual(result.updates.failedAttempts, attempt);
  Object.assign(secret, result.updates);
}
assert.ok(checkRecipientCode(secret, "123456", now + 1).error, "even a correct code must respect the retry lock");
assert.ok(!checkRecipientCode(secret, "123456", now + 5 * 60000).error);
assert.strictEqual(checkRecipientCode(secret, "000000", now + 5 * 60000).updates.failedAttempts, 1);
assert.throws(() => requireConfirmedDelivery({requiresRecipientCode: true}));
assert.throws(() => requireConfirmedDelivery({requiresDeliveryPhoto: true}));
assert.throws(() => requireConfirmedDelivery({requiresRecipientCode: true, requiresDeliveryPhoto: true, recipientCodeVerified: true}));
requireConfirmedDelivery({requiresRecipientCode: true, requiresDeliveryPhoto: true, recipientCodeVerified: true, deliveryPhotoSubmitted: true});
requireConfirmedDelivery({});
console.log("Delivery confirmation validation checks passed");
