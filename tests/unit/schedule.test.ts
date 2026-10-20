import { describe, expect, it } from "vitest";
import {
  canTransition,
  daysInMonth,
  graceEnd,
  isEscalationState,
  isValidTimeZone,
  nextDueAfter,
  parseLocalTime,
  periodDays,
  reminderScheduleFor,
  resolveAnchorDay,
  SCHEDULE_TRANSITIONS,
  type ScheduleSpec,
} from "@/lib/checkin/schedule";

/**
 * Pure scheduling math: timezone-aware due-date computation, the state
 * machine that gates escalation, and reminder placement rules.
 */

const base: ScheduleSpec = {
  frequency: "weekly",
  localTime: "09:00",
  timezone: "Africa/Nairobi",
  anchorDate: "2026-01-05", // a Monday
};

describe("state machine", () => {
  it("allows the documented escalation path", () => {
    expect(canTransition("active", "reminder_sent")).toBe(true);
    expect(canTransition("reminder_sent", "overdue")).toBe(true);
    expect(canTransition("overdue", "grace_period")).toBe(true);
    expect(canTransition("grace_period", "verification_pending")).toBe(true);
    expect(canTransition("verification_pending", "release_scheduled")).toBe(true);
    expect(canTransition("release_scheduled", "released")).toBe(true);
  });

  it("lets any escalation state return to active on check-in", () => {
    for (const from of ["reminder_sent", "overdue", "grace_period", "verification_pending", "release_scheduled", "released"]) {
      expect(canTransition(from as never, "active")).toBe(true);
    }
  });

  it("forwards skipping escalation states", () => {
    expect(canTransition("active", "overdue")).toBe(true);
    expect(canTransition("active", "released")).toBe(false);
    expect(canTransition("overdue", "released")).toBe(false);
    expect(canTransition("released", "verification_pending")).toBe(false);
  });

  it("keeps every transition inside the state set", () => {
    const known = new Set(Object.keys(SCHEDULE_TRANSITIONS));
    for (const [from, targets] of Object.entries(SCHEDULE_TRANSITIONS)) {
      expect(known.has(from)).toBe(true);
      for (const to of targets) expect(known.has(to)).toBe(true);
    }
  });

  it("classifies escalation states", () => {
    expect(isEscalationState("active")).toBe(false);
    expect(isEscalationState("incident")).toBe(false);
    expect(isEscalationState("overdue")).toBe(true);
    expect(isEscalationState("verification_pending")).toBe(true);
  });
});

describe("local time and timezones", () => {
  it("parses valid 24-hour times", () => {
    expect(parseLocalTime("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseLocalTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseLocalTime("09:05")).toEqual({ hour: 9, minute: 5 });
  });

  it("rejects malformed times", () => {
    for (const bad of ["24:00", "9:00", "09:60", "0900", "", "noon"]) {
      expect(parseLocalTime(bad)).toBeNull();
    }
  });

  it("validates IANA zones", () => {
    expect(isValidTimeZone("Africa/Nairobi")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});

describe("anchor days", () => {
  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("clamps anchors past the end of the month", () => {
    expect(resolveAnchorDay(31, 2026, 2)).toBe(28);
    expect(resolveAnchorDay(31, 2028, 2)).toBe(29);
    expect(resolveAnchorDay(15, 2026, 6)).toBe(15);
    expect(resolveAnchorDay(29, 2027, 2)).toBe(28); // yearly Feb-29 non-leap
  });
});

describe("nextDueAfter", () => {
  const after = new Date("2026-03-10T07:00:00.000Z"); // 10:00 in Nairobi (UTC+3)

  it("computes the next daily occurrence strictly after now", () => {
    const next = nextDueAfter({ ...base, frequency: "daily" }, after)!;
    // 09:00 Nairobi on Mar 10 is 06:00Z — already past 07:00Z, so due Mar 11.
    expect(next.toISOString()).toBe("2026-03-11T06:00:00.000Z");
  });

  it("keeps weekly due dates on the anchor weekday", () => {
    const next = nextDueAfter(base, after)!;
    expect(next.toISOString()).toBe("2026-03-16T06:00:00.000Z"); // next Monday
    expect(next.getUTCDay()).toBe(1);
  });

  it("rolls monthly anchors past month end without skipping months", () => {
    const spec: ScheduleSpec = { ...base, frequency: "monthly", anchorDate: "2026-01-31" };
    const feb = nextDueAfter(spec, new Date("2026-02-01T00:00:00.000Z"))!;
    expect(feb.toISOString()).toBe("2026-02-28T06:00:00.000Z");
    const mar = nextDueAfter(spec, feb)!;
    expect(mar.toISOString()).toBe("2026-03-31T06:00:00.000Z"); // back to day 31
  });

  it("computes yearly occurrences", () => {
    const spec: ScheduleSpec = { ...base, frequency: "yearly", anchorDate: "2026-06-15" };
    const next = nextDueAfter(spec, new Date("2026-08-01T00:00:00.000Z"))!;
    expect(next.toISOString()).toBe("2027-06-15T06:00:00.000Z");
  });

  it("returns null for invalid inputs", () => {
    expect(nextDueAfter({ ...base, timezone: "Not/AZone" }, after)).toBeNull();
    expect(nextDueAfter({ ...base, localTime: "99:99" }, after)).toBeNull();
    expect(nextDueAfter({ ...base, anchorDate: "05/01/2026" }, after)).toBeNull();
  });

  it("handles DST-observing zones (US spring forward)", () => {
    const spec: ScheduleSpec = {
      frequency: "daily",
      localTime: "02:30",
      timezone: "America/New_York",
      anchorDate: "2026-01-05",
    };
    // 2026-03-08 is the spring-forward day: 02:30 does not exist locally.
    const next = nextDueAfter(spec, new Date("2026-03-08T00:00:00.000Z"))!;
    expect(next).toBeInstanceOf(Date);
    // Luxon policy: nonexistent local times shift forward by the delta.
    expect(next.toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
  });
});

describe("reminders", () => {
  const due = new Date("2026-03-16T06:00:00.000Z");
  const DAY = 86_400_000;

  it("places d4, d1, due and post1 relative to the due time, sorted", () => {
    const out = reminderScheduleFor(due, base, ["post1", "due", "d1", "d4"]);
    expect(out.map((r) => r.kind)).toEqual(["d4", "d1", "due", "post1"]);
    expect(out[0]!.at.getTime()).toBe(due.getTime() - 4 * DAY);
    expect(out[3]!.at.getTime()).toBe(due.getTime() + DAY); // post1 fires a day after due
  });

  it("suppresses reminders that are not shorter than the period", () => {
    const daily: ScheduleSpec = { ...base, frequency: "daily" };
    // period = 1 day: d1/post1 span 1 day (not shorter) and d4 spans 4 → only "due" survives.
    expect(reminderScheduleFor(due, daily, ["d4", "d1", "due", "post1"]).map((r) => r.kind)).toEqual(["due"]);
    const weeklyOut = reminderScheduleFor(due, base, ["d4"]);
    expect(weeklyOut).toHaveLength(1); // 4 days < 7-day period
  });

  it("ignores unknown reminder kinds", () => {
    expect(reminderScheduleFor(due, base, ["nope" as never])).toEqual([]);
  });

  it("periodDays matches frequencies", () => {
    expect(periodDays("daily")).toBe(1);
    expect(periodDays("weekly")).toBe(7);
    expect(periodDays("monthly")).toBe(28);
    expect(periodDays("yearly")).toBe(365);
  });
});

describe("grace window", () => {
  it("ends grace hours after the due time", () => {
    const due = new Date("2026-03-16T06:00:00.000Z");
    expect(graceEnd(due, 72).toISOString()).toBe("2026-03-19T06:00:00.000Z");
  });
});
