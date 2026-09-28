/** Hungarian minimum-cost assignment. The dispatch service supplies only scores. */
export function hungarianAssignment(cost: number[][]): Array<{row: number; column: number}> {
  if (cost.length === 0 || cost[0].length === 0) return [];
  const rows = cost.length;
  const columns = cost[0].length;
  const transposed = rows > columns;
  const matrix = transposed ? Array.from({length: columns}, (_, i) => cost.map(row => row[i])) : cost;
  const n = matrix.length;
  const m = matrix[0].length;
  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(Infinity);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) if (!used[j]) {
        const current = matrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minv[j]) { minv[j] = current; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 !== 0);
  }
  const result: Array<{row: number; column: number}> = [];
  for (let j = 1; j <= m; j += 1) if (p[j] > 0) {
    result.push(transposed ? {row: j - 1, column: p[j] - 1} : {row: p[j] - 1, column: j - 1});
  }
  return result;
}
