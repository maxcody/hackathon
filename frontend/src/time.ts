/** Format a timestamp for the viewer's local timezone. */
export function localTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

const LAUNCH = new Date("2026-11-22T20:00:00+01:00");

/** Time left until launch, e.g. "16 h 40 min left". */
export function timeToLaunch(): string {
  const minutes = Math.round((LAUNCH.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "launched";
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}
