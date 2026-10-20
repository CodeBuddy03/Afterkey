import { DateTime } from "luxon";

/**
 * Pure check-in scheduling math — timezone aware (IANA zones, DST), leap-year
 * safe, with a documented policy for local times that do not exist on DST
 * transition days (luxon shifts them forward by the transition delta).
 *
 * All functions are deterministic and unit-tested (tests/unit/schedule.test.ts).
 */

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export type ScheduleState =
  | "active"
  | "reminder_sent"
  | "overdue"
  | "grace_period"
  | "verification_pending"
  | "release_scheduled"
  | "released"
  | "incident";

export const SCHEDULE_STATES: ScheduleState[] = [
  "active",
  "reminder_sent",
  "overdue",
  "grace_period",
  "verification_pending",
  "release_scheduled",
  "released",
  "incident",
];

/**
 * Allowed state transitions. Enforced server-side by conditional UPDATEs
 * (compare-and-swap), so stale jobs cannot drive an illegal transition.
 *
 * active → reminder_sent → overdue → grace_period → verification_pending
 *        → release_scheduled → released
 * Any non-terminal escalation state returns to `active` when the user checks
 * in or cancels a pending release; `incident` is for administrative holds.
 */
export const SCHEDULE_TRANSITIONS: Record<ScheduleState, ScheduleState[]> = {
  active: ["active", "reminder_sent", "overdue", "grace_period", "verification_pending", "incident"],
  reminder_sent: ["active", "overdue", "grace_period", "verification_pending", "incident"],
  overdue: ["active", "grace_period", "verification_pending", "incident"],
  grace_period: ["active", "verification_pending", "incident"],
  verification_pending: ["active", "release_scheduled", "incident"],
  release_scheduled: ["active", "released", "incident"],
  released: ["active", "incident"],
  incident: ["active", "verification_pending"],
};

export function canTransition(from: ScheduleState, to: ScheduleState): boolean {
  return (SCHEDULE_TRANSITIONS[from] ?? []).includes(to);
}

export function isEscalationState(state: ScheduleState): boolean {
  return state !== "active" && state !== "incident";
}

export interface ScheduleSpec {
  frequency: Frequency;
  /** "HH:MM" local time */
  localTime: string;
  timezone: string;
  /** YYYY-MM-DD anchor defining weekday / day-of-month / month-day */
  anchorDate: string;
}

export type ReminderKind = "d4" | "d1" | "due" | "post1";

export function parseLocalTime(localTime: string): { hour: number; minute: number } | null {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(localTime);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function isValidTimeZone(timezone: string): boolean {
  try {
    return DateTime.local().setZone(timezone).isValid;
  } catch {
    return false;
  }
}

function anchorParts(anchorDate: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Number of days per month in a given month (1-12), year-aware. */
export function daysInMonth(year: number, month: number): number {
  return DateTime.fromObject({ year, month, day: 1 }).daysInMonth ?? 31;
}

/**
 * Policy: a monthly anchor day beyond the month's length clamps to the last
 * day (Jan 31 → Feb 28/29), then returns to day 31 when the month allows it.
 * A yearly anchor of 29 Feb clamps to 28 Feb in non-leap years.
 */
export function resolveAnchorDay(anchorDay: number, year: number, month: number): number {
  const dim = daysInMonth(year, month);
  return Math.min(anchorDay, dim);
}

function atTime(dt: DateTime, hour: number, minute: number): DateTime {
  return dt.set({ hour, minute, second: 0, millisecond: 0 });
}

/** Next due time strictly after `after`, in the schedule's timezone. */
export function nextDueAfter(spec: ScheduleSpec, after: Date): Date | null {
  const anchor = anchorParts(spec.anchorDate);
  const time = parseLocalTime(spec.localTime);
  if (!anchor || !time) return null;
  if (!isValidTimeZone(spec.timezone)) return null;

  const zone = spec.timezone;
  const afterDt = DateTime.fromJSDate(after).setZone(zone);
  if (!afterDt.isValid) return null;

  let candidate: DateTime | null = null;

  switch (spec.frequency) {
    case "daily": {
      candidate = atTime(DateTime.fromObject({ year: afterDt.year, month: afterDt.month, day: afterDt.day }, { zone }), time.hour, time.minute);
      if (candidate <= afterDt) candidate = candidate.plus({ days: 1 });
      break;
    }
    case "weekly": {
      const anchorWeekday = DateTime.fromObject({ year: anchor.year, month: anchor.month, day: anchor.day }, { zone }).weekday;
      let d = atTime(DateTime.fromObject({ year: afterDt.year, month: afterDt.month, day: afterDt.day }, { zone }), time.hour, time.minute);
      while (d.weekday !== anchorWeekday || d <= afterDt) {
        d = d.plus({ days: 1 });
        if (d > afterDt.plus({ days: 8 })) return null; // safety
        if (d.weekday === anchorWeekday && d > afterDt) break;
      }
      candidate = d;
      break;
    }
    case "monthly": {
      let y = afterDt.year;
      let m = afterDt.month;
      for (let i = 0; i < 24; i++) {
        const day = resolveAnchorDay(anchor.day, y, m);
        const dt = atTime(DateTime.fromObject({ year: y, month: m, day }, { zone }), time.hour, time.minute);
        if (dt > afterDt) {
          candidate = dt;
          break;
        }
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      break;
    }
    case "yearly": {
      let y = afterDt.year;
      for (let i = 0; i < 4; i++) {
        const day = resolveAnchorDay(anchor.day, y, anchor.month);
        const dt = atTime(DateTime.fromObject({ year: y, month: anchor.month, day }, { zone }), time.hour, time.minute);
        if (dt > afterDt) {
          candidate = dt;
          break;
        }
        y += 1;
      }
      break;
    }
  }

  if (!candidate || !candidate.isValid) return null;
  return candidate.toJSDate();
}

/** Approximate period of the schedule in days (used to filter impossible reminders). */
export function periodDays(frequency: Frequency): number {
  switch (frequency) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "monthly":
      return 28;
    case "yearly":
      return 365;
  }
}

export interface ReminderSchedule {
  kind: ReminderKind;
  at: Date;
}

const REMINDER_OFFSET_DAYS: Record<ReminderKind, number> = { d4: -4, d1: -1, due: 0, post1: 1 };

/**
 * Reminder fire times for a given due date.
 *
 * Rule (spec): a four-day advance reminder is only scheduled when the
 * interval allows it — the offset must be shorter than the period itself.
 */
export function reminderScheduleFor(due: Date, spec: ScheduleSpec, reminders: ReminderKind[]): ReminderSchedule[] {
  const period = periodDays(spec.frequency);
  const out: ReminderSchedule[] = [];
  for (const kind of reminders) {
    const offsetDays = REMINDER_OFFSET_DAYS[kind];
    if (offsetDays === undefined) continue;
    const span = Math.abs(offsetDays);
    if (span >= period) continue; // e.g. no 4-day reminder on a daily schedule
    const at = new Date(due.getTime() + offsetDays * 86_400_000);
    out.push({ kind, at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function graceEnd(due: Date, graceHours: number): Date {
  return new Date(due.getTime() + graceHours * 3_600_000);
}

export function overdueNoticeEnd(due: Date, noticeHours: number): Date {
  return new Date(due.getTime() + noticeHours * 3_600_000);
}

export function formatDateInZone(date: Date, zone: string, withTime = true): string {
  const dt = DateTime.fromJSDate(date).setZone(zone);
  if (!dt.isValid) return date.toISOString();
  return dt.toFormat(withTime ? "cccc d LLLL yyyy 'at' HH:mm" : "cccc d LLLL yyyy");
}

export function formatRelativeZone(date: Date, zone: string): string {
  const dt = DateTime.fromJSDate(date).setZone(zone);
  if (!dt.isValid) return date.toISOString();
  return dt.toFormat("yyyy-LL-dd HH:mm ZZZZ");
}
