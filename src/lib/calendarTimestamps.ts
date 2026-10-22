/** Sheets timestamps without an offset are Asia/Taipei (UTC+08:00).
 * ISO timestamps retain their explicit offset. Never use the browser timezone.
 */
export function calendarTimestamp(value: string): number | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) return null;
  const [, date, hour, minute, second, fraction = "", zone = "+08:00"] = match;
  const civil = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(civil.getTime()) ||
    civil.toISOString().slice(0, 10) !== date ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return null;
  if (
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  )
    return null;
  const result = Date.parse(
    `${date}T${hour}:${minute}:${second}${fraction}${zone}`,
  );
  return Number.isFinite(result) ? result : null;
}
