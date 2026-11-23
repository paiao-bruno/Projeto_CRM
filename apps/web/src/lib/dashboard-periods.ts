export const DASHBOARD_TIMEZONE = "America/Sao_Paulo";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function tzOffsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

export function zonedDateTimeToUtc(
  ymd: string,
  timeZone: string,
  hours = 0,
  minutes = 0,
  seconds = 0,
) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error("Data inválida (use AAAA-MM-DD).");
  const naive = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes, seconds);
  const first = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  return new Date(naive - tzOffsetMs(first, timeZone));
}

export function formatYmd(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

export function startOfMonthYmd(ymd: string) {
  return `${ymd.slice(0, 7)}-01`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastYmdOfMonth(ymd: string) {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  return `${ymd.slice(0, 7)}-${pad(daysInMonth(year, month))}`;
}

export type PeriodRange = {
  fromYmd: string;
  toYmdInclusive: string;
  from: Date;
  toExclusive: Date;
  timeZone: string;
  preset: string;
  comparisonKind: "previous_month" | "equivalent_elapsed" | "previous_interval";
  comparisonLabel: string;
};

export function inclusiveRange(fromYmd: string, toYmdInclusive: string, timeZone: string, preset: string): PeriodRange {
  if (fromYmd > toYmdInclusive) throw new Error("A data inicial deve ser anterior ou igual à data final.");
  const from = zonedDateTimeToUtc(fromYmd, timeZone);
  const toExclusive = zonedDateTimeToUtc(addDaysYmd(toYmdInclusive, 1), timeZone);
  const startMonth = startOfMonthYmd(fromYmd);
  const endMonthLast = lastYmdOfMonth(fromYmd);
  const fullMonth = fromYmd === startMonth && toYmdInclusive === endMonthLast;
  const nowYmd = formatYmd(new Date(), timeZone);
  const currentMonthPartial =
    fromYmd === startMonth && toYmdInclusive < endMonthLast && fromYmd.slice(0, 7) === nowYmd.slice(0, 7);

  let comparisonKind: PeriodRange["comparisonKind"] = "previous_interval";
  if (fullMonth) comparisonKind = "previous_month";
  else if (currentMonthPartial) comparisonKind = "equivalent_elapsed";

  const previous = previousRange(fromYmd, toYmdInclusive, comparisonKind);
  const label =
    comparisonKind === "previous_month"
      ? `vs. mês anterior (${previous.fromYmd} a ${previous.toYmdInclusive})`
      : comparisonKind === "equivalent_elapsed"
        ? `vs. trecho equivalente do mês anterior (${previous.fromYmd} a ${previous.toYmdInclusive})`
        : `vs. intervalo anterior de mesma duração (${previous.fromYmd} a ${previous.toYmdInclusive})`;

  return { fromYmd, toYmdInclusive, from, toExclusive, timeZone, preset, comparisonKind, comparisonLabel: label };
}

export function previousRange(
  fromYmd: string,
  toYmdInclusive: string,
  kind: PeriodRange["comparisonKind"],
) {
  if (kind === "previous_month" || kind === "equivalent_elapsed") {
    const year = Number(fromYmd.slice(0, 4));
    const month = Number(fromYmd.slice(5, 7));
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevStart = `${prevYear}-${pad(prevMonth)}-01`;
    if (kind === "previous_month") {
      return { fromYmd: prevStart, toYmdInclusive: lastYmdOfMonth(prevStart) };
    }
    const day = Number(toYmdInclusive.slice(8, 10));
    const clamped = Math.min(day, daysInMonth(prevYear, prevMonth));
    return { fromYmd: prevStart, toYmdInclusive: `${prevYear}-${pad(prevMonth)}-${pad(clamped)}` };
  }
  const days = Math.round(
    (Date.parse(`${toYmdInclusive}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const prevEnd = addDaysYmd(fromYmd, -1);
  const prevStart = addDaysYmd(fromYmd, -days);
  return { fromYmd: prevStart, toYmdInclusive: prevEnd };
}

export function defaultMonthToDate(now: Date, timeZone: string) {
  const today = formatYmd(now, timeZone);
  return inclusiveRange(startOfMonthYmd(today), today, timeZone, "month_to_date");
}

export function parseDashboardPeriod(
  query: { from?: string | null; to?: string | null; preset?: string | null },
  now = new Date(),
  timeZone = DASHBOARD_TIMEZONE,
): PeriodRange {
  const today = formatYmd(now, timeZone);
  const preset = query.preset?.trim() || "month_to_date";
  if (query.from && query.to) {
    return inclusiveRange(query.from, query.to > today ? today : query.to, timeZone, "custom");
  }
  if (preset === "7d") return inclusiveRange(addDaysYmd(today, -6), today, timeZone, "7d");
  if (preset === "30d") return inclusiveRange(addDaysYmd(today, -29), today, timeZone, "30d");
  if (preset === "90d") return inclusiveRange(addDaysYmd(today, -89), today, timeZone, "90d");
  return defaultMonthToDate(now, timeZone);
}

export function relativeChange(current: number, previous: number): { kind: "pct" | "none"; value: number | null } {
  if (previous === 0) return { kind: "none", value: null };
  return { kind: "pct", value: ((current - previous) / previous) * 100 };
}

export function percentPointDelta(current: number | null, previous: number | null) {
  if (current == null || previous == null) return null;
  return (current - previous) * 100;
}

export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

export type HorizonKind = "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export function horizonRange(kind: HorizonKind, referenceYmd: string, timeZone: string) {
  if (kind === "weekly") return inclusiveRange(addDaysYmd(referenceYmd, -6), referenceYmd, timeZone, kind);
  if (kind === "biweekly") return inclusiveRange(addDaysYmd(referenceYmd, -14), referenceYmd, timeZone, kind);
  if (kind === "monthly") {
    return inclusiveRange(startOfMonthYmd(referenceYmd), referenceYmd, timeZone, kind);
  }
  const year = Number(referenceYmd.slice(0, 4));
  const month = Number(referenceYmd.slice(5, 7));
  const monthsBack = kind === "quarterly" ? 2 : kind === "semiannual" ? 5 : 11;
  let startMonth = month - monthsBack;
  let startYear = year;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  const fromYmd = `${startYear}-${pad(startMonth)}-01`;
  return inclusiveRange(fromYmd, referenceYmd, timeZone, kind);
}

export function monthCloses(referenceYmd: string, count: number) {
  const months: string[] = [];
  let year = Number(referenceYmd.slice(0, 4));
  let month = Number(referenceYmd.slice(5, 7));
  for (let i = 0; i < count; i += 1) {
    const start = `${year}-${pad(month)}-01`;
    const last = lastYmdOfMonth(start);
    months.unshift(referenceYmd.slice(0, 7) === `${year}-${pad(month)}` ? referenceYmd : last);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}
