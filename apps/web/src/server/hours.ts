import { HttpError } from "./http";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WorkingHours = Partial<Record<Weekday, [string, string][]>>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valida o expediente: { "mon": [["08:00","12:00"],["13:00","18:00"]] }. Faixas ordenadas e sem sobreposição. */
export function parseWorkingHours(value: unknown): WorkingHours | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "workingHours deve ser um objeto.");
  const result: WorkingHours = {};
  for (const [day, ranges] of Object.entries(value as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) throw new HttpError(422, `Dia invalido em workingHours: ${day}.`);
    if (!Array.isArray(ranges)) throw new HttpError(422, `workingHours.${day} deve ser uma lista de faixas.`);
    const parsed: [string, string][] = [];
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2 || !HHMM.test(String(range[0])) || !HHMM.test(String(range[1]))) {
        throw new HttpError(422, `Faixa invalida em workingHours.${day} (use HH:MM).`);
      }
      if (String(range[0]) >= String(range[1])) throw new HttpError(422, `Faixa invalida em workingHours.${day}: inicio deve ser anterior ao fim.`);
      parsed.push([String(range[0]), String(range[1])]);
    }
    parsed.sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < parsed.length; i += 1) {
      if (parsed[i][0] < parsed[i - 1][1]) throw new HttpError(422, `Faixas sobrepostas em workingHours.${day}.`);
    }
    result[day as Weekday] = parsed;
  }
  return result;
}

export function parseTimezone(value: unknown, fallback = "America/Sao_Paulo") {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: String(value) });
    return String(value);
  } catch {
    throw new HttpError(422, "timezone invalido.");
  }
}

/** Sem expediente configurado (null ou objeto vazio) = sempre aberto. Dia sem faixas = fechado. */
export function isOpenAt(hours: WorkingHours | null | undefined, timezone: string, at: Date = new Date()) {
  if (!hours || Object.keys(hours).length === 0) return true;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = get("weekday").slice(0, 3).toLowerCase() as Weekday;
  const time = `${get("hour")}:${get("minute")}`;
  return (hours[day] ?? []).some(([start, end]) => time >= start && time < end);
}
