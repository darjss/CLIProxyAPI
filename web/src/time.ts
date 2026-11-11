const day = 86400;

export function startOfDay(seconds: number) {
  const date = new Date(seconds * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** Local midnights inside [start, end]. */
export function dayTicks(start: number, end: number) {
  const ticks: number[] = [];
  const date = new Date(startOfDay(start) * 1000);
  while (date.getTime() / 1000 <= end) {
    if (date.getTime() / 1000 >= start) ticks.push(date.getTime() / 1000);
    date.setDate(date.getDate() + 1);
  }
  return ticks;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDay = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const weekdayTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const monthDayTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const shortDateTime = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const tickLabel = (seconds: number) =>
  weekday.format(seconds * 1000) + " " + new Date(seconds * 1000).getDate();
export const shortDate = (seconds: number) => monthDay.format(seconds * 1000);
export const numericDateTime = (seconds: number) =>
  shortDateTime.format(seconds * 1000);

/** "Sun 4:39 PM" within the coming week, otherwise "Nov 9, 4:39 PM". */
export function when(seconds: number, now = Date.now() / 1000) {
  return Math.abs(seconds - now) < 6 * day
    ? weekdayTime.format(seconds * 1000)
    : monthDayTime.format(seconds * 1000);
}

/** Compact distance such as "15h 49m" or "2d 18h". */
export function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
  if (s < day)
    return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / day) + "d " + Math.floor((s % day) / 3600) + "h";
}

export function relative(seconds: number, now = Date.now() / 1000) {
  const delta = seconds - now;
  if (Math.abs(delta) < 60) return "just now";
  return delta > 0 ? "in " + span(delta) : span(-delta) + " ago";
}
