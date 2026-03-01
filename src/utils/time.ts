export const HOUR_MS = 60 * 60 * 1000;

export function floorToHour(tsMs: number): number {
  return Math.floor(tsMs / HOUR_MS) * HOUR_MS;
}

export function formatElapsedHhMm(fromMs: number, toMs: number): string {
  const diff = Math.max(0, toMs - fromMs);
  const totalMin = Math.floor(diff / 60000);
  const dd = Math.floor(totalMin / (24 * 60));
  const hh = Math.floor((totalMin % (24 * 60)) / 60);
  const mm = totalMin % 60;
  return `${String(dd).padStart(2, "0")} - ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
