package com.osulsa.mylife;

import java.time.*;
import java.util.*;

public final class ReminderTimeCalculatorTest {
  public static void main(String[] args) {
    ZoneId zone = ZoneId.of("America/New_York");

    assertEq(7, ReminderTimeCalculator.parseReminderDays("7 days before"), "parse 7 days");
    assertEq(1, ReminderTimeCalculator.parseReminderDays("1 day before"), "parse 1 day");
    assertEq(0, ReminderTimeCalculator.parseReminderDays("On the due date"), "same-day reminder");
    assertEq(0, ReminderTimeCalculator.parseReminderDays(""), "blank reminder");

    ZonedDateTime beforeNine = ZonedDateTime.of(2026, 8, 19, 8, 0, 0, 0, zone);
    ZonedDateTime afterNine = ZonedDateTime.of(2026, 8, 19, 10, 0, 0, 0, zone);
    assertEq(LocalDate.of(2026,8,19), ReminderTimeCalculator.nextDaily(beforeNine, 9, 0).toLocalDate(), "daily today before time");
    assertEq(LocalDate.of(2026,8,20), ReminderTimeCalculator.nextDaily(afterNine, 9, 0).toLocalDate(), "daily tomorrow after time");

    Set<DayOfWeek> weekdays = EnumSet.of(DayOfWeek.MONDAY, DayOfWeek.FRIDAY);
    ZonedDateTime wed = ZonedDateTime.of(2026, 8, 19, 12, 0, 0, 0, zone); // Wednesday
    assertEq(DayOfWeek.FRIDAY, ReminderTimeCalculator.nextOnWeekdays(wed, weekdays, 9, 0).getDayOfWeek(), "weekday next Friday");

    LocalDate anchor = LocalDate.of(2026, 8, 1);
    ZonedDateTime now = ZonedDateTime.of(2026, 8, 19, 12, 0, 0, 0, zone);
    assertEq(LocalDate.of(2026,8,22), ReminderTimeCalculator.nextEveryDays(now, anchor, 7, 9, 0).toLocalDate(), "every 7 days");

    LocalDate monthAnchor = LocalDate.of(2026, 1, 31);
    ZonedDateTime feb = ZonedDateTime.of(2026, 2, 1, 10, 0, 0, 0, zone);
    assertEq(LocalDate.of(2026,2,28), ReminderTimeCalculator.nextEveryMonths(feb, monthAnchor, 1, 9, 0).toLocalDate(), "monthly clamps day");

    ZonedDateTime dueNow = ZonedDateTime.of(2026, 8, 19, 8, 0, 0, 0, zone);
    Optional<ZonedDateTime> oneTime = ReminderTimeCalculator.nextOneTime(dueNow, LocalDate.of(2026,8,26), 9, 0, 7);
    assertTrue(oneTime.isPresent(), "one-time present");
    assertEq(LocalDate.of(2026,8,19), oneTime.get().toLocalDate(), "one-time offset");

    System.out.println("ReminderTimeCalculatorTest: PASS");
  }

  static void assertTrue(boolean value, String label) {
    if (!value) throw new AssertionError(label);
  }
  static void assertEq(Object expected, Object actual, String label) {
    if (!Objects.equals(expected, actual)) {
      throw new AssertionError(label + " expected=" + expected + " actual=" + actual);
    }
  }
}
