/** Format large document counts for display (千 / 万 tiers). */
export function formatScopeCount(value: number): string {
  if (value >= 10000) {
    const wan = value / 10000;
    return `${Number.isInteger(wan) ? wan.toFixed(0) : wan.toFixed(1)}万`;
  }
  if (value >= 1000) {
    const qian = value / 1000;
    return `${Number.isInteger(qian) ? qian.toFixed(0) : qian.toFixed(1)}千`;
  }
  return String(value);
}
