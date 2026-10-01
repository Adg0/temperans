export function todayInZone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

export function daysInYear(year: number): string[] {
  const result: string[] = [];
  let cursor = `${year}-01-01`;
  while (cursor.startsWith(String(year))) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function weekdayIndexMonday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}

export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

export function daysInMonth(year: number, month: number): string[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const result: string[] = [];
  let cursor = `${prefix}-01`;
  while (cursor.startsWith(prefix)) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function formatMonthYear(year: number, month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function monthShortName(month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short" })
    .format(new Date(Date.UTC(2000, month - 1, 1)));
}

export function monthLongName(month: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long" })
    .format(new Date(Date.UTC(2000, month - 1, 1)));
}

export function startOfDayInZone(date: string, timezone: string): number {
  const target = Date.parse(date + "T00:00:00Z");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const localDate = (time: number) => {
    const parts = formatter.formatToParts(new Date(time));
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    return part("year") + "-" + part("month") + "-" + part("day");
  };
  let low = target - 36 * 3600000, high = target + 36 * 3600000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle) < date) low = middle + 1; else high = middle;
  }
  if (localDate(low) !== date) throw new Error("This date does not exist in the configured timezone.");
  return low;
}
