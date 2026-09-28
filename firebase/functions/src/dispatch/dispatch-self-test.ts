import * as assert from "assert";
import {distanceMeters, searchCells, toH3Cell} from "./h3-service";
import {hungarianAssignment} from "./hungarian-assignment-service";
import {calculateScore, sortCandidates} from "./scoring-service";
import {DEFAULT_DISPATCH_CONFIG} from "./contracts";

function run(): void {
  // One order / nearby courier: H3 identifies a candidate and geo distance stays exact.
  const pickup = {latitude: 38.5598, longitude: 68.7870};
  const cell = toH3Cell(pickup, 8);
  assert.ok(searchCells(pickup, 8, 0).includes(cell));
  assert.ok(distanceMeters(pickup, {latitude: 38.5600, longitude: 68.7870}) < 30);

  // Load and idle time must be able to beat a slightly shorter ETA.
  const loaded = {id: "loaded", name: "", phone: "", location: pickup, h3Cell: cell, distanceMeters: 500,
    etaSeconds: 180, etaSource: "GEODESIC_FALLBACK" as const, activeOrders: 2, idleTimeSeconds: 60};
  const idle = {...loaded, id: "idle", etaSeconds: 210, activeOrders: 0, idleTimeSeconds: 3600};
  const ranked = sortCandidates([{...loaded, score: calculateScore(loaded, DEFAULT_DISPATCH_CONFIG)},
    {...idle, score: calculateScore(idle, DEFAULT_DISPATCH_CONFIG)}]);
  assert.strictEqual(ranked[0].id, "idle");

  // Batch assignment must minimise the total matrix cost rather than greedily reuse a courier.
  const result = hungarianAssignment([[12, 35, 18], [25, 10, 20], [16, 22, 8]]);
  assert.deepStrictEqual(result.sort((a, b) => a.row - b.row), [
    {row: 0, column: 0}, {row: 1, column: 1}, {row: 2, column: 2},
  ]);
}

run();
console.log("Smart Dispatch pure algorithm checks passed");
