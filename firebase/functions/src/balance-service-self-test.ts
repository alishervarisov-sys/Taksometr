import * as assert from "assert";
import * as admin from "firebase-admin";
import {balanceAlertAction, createBalanceService, parseTopUpAmount} from "./balance-service";

// An optimistic in-memory transaction fixture exercises retries and competing
// administrators without accessing a live Firebase project.
class MemoryStore {
  records = new Map<string, {version: number; data: Record<string, any>}>();
  collection(name: string) { return {doc: (id: string) => ({path: `${name}/${id}`, id})}; }
  seed(path: string, data: Record<string, any>) {
    this.records.set(path, {version: (this.records.get(path)?.version || 0) + 1, data: {...data}});
  }
  data(path: string) { return this.records.get(path)?.data; }
  async runTransaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, number>();
      const writes: Array<{path: string; data: Record<string, any>; merge: boolean}> = [];
      const tx = {
        get: async (ref: {path: string}) => {
          assert.strictEqual(writes.length, 0, "Firestore reads must precede every write");
          const record = this.records.get(ref.path);
          reads.set(ref.path, record?.version || 0);
          const data = record ? {...record.data} : undefined;
          return {exists: !!record, data: () => data, get: (key: string) => data?.[key]};
        },
        set: (ref: {path: string}, data: Record<string, any>) => writes.push({path: ref.path, data, merge: false}),
        update: (ref: {path: string}, data: Record<string, any>) => {
          assert.ok(Object.keys(data).length, "Firestore rejects an empty update");
          writes.push({path: ref.path, data, merge: true});
        },
      };
      const result = await callback(tx);
      if ([...reads].some(([path, version]) => (this.records.get(path)?.version || 0) !== version)) continue;
      for (const write of writes) this.seed(write.path, {...(write.merge ? this.data(write.path) : {}), ...write.data});
      return result;
    }
    throw new Error("Transaction retry limit exceeded");
  }
}

async function run() {
  for (const invalid of [0, -1, NaN, Infinity, "50", null, 100000.01, 10.001]) {
    assert.throws(() => parseTopUpAmount(invalid));
  }
  assert.strictEqual(parseTopUpAmount(0.01), 0.01);
  assert.strictEqual(parseTopUpAmount(10.25), 10.25);
  assert.strictEqual(balanceAlertAction(11, 10, false), "WARN");
  assert.strictEqual(balanceAlertAction(10, 2, true), "NONE");
  assert.strictEqual(balanceAlertAction(2, 7, true), "CLEAR");
  assert.strictEqual(balanceAlertAction(7, 6, false), "WARN");

  const store = new MemoryStore();
  store.seed("users/courier", {role: "COURIER", name: "Курьер", balance: 5});
  const service = createBalanceService(store as unknown as admin.firestore.Firestore, async id => {
    if (id !== "admin") throw new Error("Forbidden");
  });
  const requests = await Promise.all([
    service.requestTopUp({courierId: "courier", requestId: "r1", amount: 50}),
    service.requestTopUp({courierId: "courier", requestId: "r2", amount: 60}),
  ]);
  assert.strictEqual(requests[0].requestId, requests[1].requestId, "Only one pending request per courier");
  assert.strictEqual(store.data("users/courier")?.balance, 5, "Submitting cannot credit a balance");
  const requestId = requests[0].requestId;
  await assert.rejects(service.reviewTopUp({adminId: "courier", requestId, decision: "APPROVE", paymentStatus: "PAID"}));
  await assert.rejects(service.reviewTopUp({adminId: "admin", requestId, decision: "APPROVE", paymentStatus: "UNKNOWN"}));
  const reviews = await Promise.all([
    service.reviewTopUp({adminId: "admin", requestId, decision: "APPROVE", paymentStatus: "DEBT"}),
    service.reviewTopUp({adminId: "admin", requestId, decision: "APPROVE", paymentStatus: "DEBT"}),
  ]);
  assert.ok(reviews.some(result => "alreadyReviewed" in result && result.alreadyReviewed));
  assert.strictEqual(store.data("users/courier")?.balance, 55, "Competing approvals must credit exactly once");
  assert.strictEqual(store.data(`transactions/topup_request_${requestId}`)?.paymentStatus, "DEBT");
  assert.strictEqual(store.data("users/courier")?.pendingTopUpRequestId, "");
  assert.strictEqual([...store.records.keys()].filter(key => key.startsWith("transactions/")).length, 1);
  await assert.rejects(service.reviewTopUp({adminId: "admin", requestId, decision: "REJECT"}));

  await service.requestTopUp({courierId: "courier", requestId: "rejected", amount: 10});
  await service.reviewTopUp({adminId: "admin", requestId: "rejected", decision: "REJECT"});
  assert.strictEqual(store.data("users/courier")?.balance, 55, "Rejection must not credit or debit");
  await service.requestTopUp({courierId: "courier", requestId: "paid", amount: 0.25});
  await service.reviewTopUp({adminId: "admin", requestId: "paid", decision: "APPROVE", paymentStatus: "PAID"});
  assert.strictEqual(store.data("users/courier")?.balance, 55.25);
  assert.ok(store.data("transactions/topup_request_paid")?.paidAt);

  store.seed("users/low", {role: "COURIER", balance: 10});
  await service.handleBalanceChange("low", 11, 10, "debit", 100);
  await service.handleBalanceChange("low", 11, 10, "debit", 100);
  assert.strictEqual(store.data("users/low")?.lowBalanceNotificationActive, true);
  const warnings = () => [...store.records.values()].filter(row => row.data.courierId === "low" && row.data.type === "LOW_BALANCE");
  assert.strictEqual(warnings().length, 1, "Duplicate trigger events must not duplicate warnings");
  store.seed("users/low", {...store.data("users/low"), balance: 2});
  await service.handleBalanceChange("low", 10, 2, "debit2", 200);
  assert.strictEqual(warnings().length, 1, "Further debits during an active warning must not spam");
  store.seed("users/low", {...store.data("users/low"), balance: 7});
  await service.handleBalanceChange("low", 2, 7, "credit", 300);
  assert.strictEqual(store.data("users/low")?.lowBalanceNotificationActive, false, "Even a small approved credit clears the warning");
  await service.handleBalanceChange("low", 10, 2, "late-debit", 200);
  assert.strictEqual(store.data("users/low")?.lowBalanceNotificationActive, false, "An old debit cannot restore a cleared warning");
  store.seed("users/low", {...store.data("users/low"), balance: 6});
  await service.handleBalanceChange("low", 7, 6, "new-debit", 400);
  assert.strictEqual(warnings().length, 2);
  console.log("Balance workflow checks passed: validation, pending requests, concurrent approvals, paid/debt, rejection and low-balance event ordering.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
