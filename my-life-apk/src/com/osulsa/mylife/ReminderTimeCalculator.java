package com.osulsa.mylife;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ReminderTimeCalculator {
  private ReminderTimeCalculator() {}

  public static int parseReminderDays(String text) {
    if (text == null || text.trim().isEmpty()) return 0;
    Matcher matcher = Pattern.compile("(\\d+)\\s+days?", Pattern.CASE_INSENSITIVE).matcher(text);
    if (matcher.find()) return Math.max(0, Integer.parseInt(matcher.group(1)));
    return 0;
  }

  public static ZonedDateTime nextDaily(ZonedDateTime now, int hour, int minute) {
    ZonedDateTime candidate = at(now.toLocalDate(), now.getZone(), hour, minute);
    if (!candidate.isAfter(now)) candidate = candidate.plusDays(1);
    return candidate;
  }

  public static ZonedDateTime nextOnWeekdays(
      ZonedDateTime now, Set<DayOfWeek> weekdays, int hour, int minute) {
    if (weekdays == null || weekdays.isEmpty()) return nextDaily(now, hour, minute);
    for (int offset = 0; offset < 8; offset++) {
      LocalDate date = now.toLocalDate().plusDays(offset);
      if (!weekdays.contains(date.getDayOfWeek())) continue;
      ZonedDateTime candidate = at(date, now.getZone(), hour, minute);
      if (candidate.isAfter(now)) return candidate;
    }
    return at(now.toLocalDate().plusDays(7), now.getZone(), hour, minute);
  }

  public static ZonedDateTime nextEveryDays(
      ZonedDateTime now, LocalDate anchor, int intervalDays, int hour, int minute) {
    int interval = Math.max(1, intervalDays);
    LocalDate base = anchor == null ? now.toLocalDate() : anchor;
    long elapsed = Math.max(0, ChronoUnit.DAYS.between(base, now.toLocalDate()));
    long steps = elapsed / interval;
    LocalDate date = base.plusDays(steps * interval);
    ZonedDateTime candidate = at(date, now.getZone(), hour, minute);
    while (!candidate.isAfter(now)) candidate = candidate.plusDays(interval);
    return candidate;
  }

  public static ZonedDateTime nextEveryMonths(
      ZonedDateTime now, LocalDate anchor, int intervalMonths, int hour, int minute) {
    int interval = Math.max(1, intervalMonths);
    LocalDate base = anchor == null ? now.toLocalDate() : anchor;
    int desiredDay = base.getDayOfMonth();
    LocalDate monthCursor = base.withDayOfMonth(1);
    while (true) {
      int safeDay = Math.min(desiredDay, monthCursor.lengthOfMonth());
      LocalDate date = monthCursor.withDayOfMonth(safeDay);
      ZonedDateTime candidate = at(date, now.getZone(), hour, minute);
      if (candidate.isAfter(now)) return candidate;
      monthCursor = monthCursor.plusMonths(interval);
    }
  }

  public static ZonedDateTime nextYearly(
      ZonedDateTime now, LocalDate anchor, int hour, int minute) {
    LocalDate base = anchor == null ? now.toLocalDate() : anchor;
    int year = Math.max(base.getYear(), now.getYear());
    while (true) {
      LocalDate date = safeDate(year, base.getMonthValue(), base.getDayOfMonth());
      ZonedDateTime candidate = at(date, now.getZone(), hour, minute);
      if (candidate.isAfter(now)) return candidate;
      year++;
    }
  }

  public static Optional<ZonedDateTime> nextOneTime(
      ZonedDateTime now, LocalDate dueDate, int hour, int minute, int remindDays) {
    if (dueDate == null) return Optional.empty();
    ZonedDateTime candidate = at(dueDate.minusDays(Math.max(0, remindDays)), now.getZone(), hour, minute);
    return candidate.isAfter(now) ? Optional.of(candidate) : Optional.empty();
  }

  public static LocalDate safeDate(int year, int month, int day) {
    YearMonth ym = YearMonth.of(year, month);
    return ym.atDay(Math.min(Math.max(1, day), ym.lengthOfMonth()));
  }

  private static ZonedDateTime at(LocalDate date, ZoneId zone, int hour, int minute) {
    int safeHour = Math.max(0, Math.min(23, hour));
    int safeMinute = Math.max(0, Math.min(59, minute));
    return ZonedDateTime.of(date, LocalTime.of(safeHour, safeMinute), zone);
  }
}
