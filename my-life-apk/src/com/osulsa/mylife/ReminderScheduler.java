package com.osulsa.mylife;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

import java.time.*;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class ReminderScheduler {
  private static final String PREFS = "my_life_reminders";
  private static final String KEY_SET = "scheduled_keys";
  private static final String SPEC_PREFIX = "spec:";
  private static final int DEFAULT_HOUR = 9;

  private ReminderScheduler() {}

  public static void syncState(Context context, String stateJson) {
    try {
      JSONObject state = new JSONObject(stateJson);
      clearAll(context);
      List<JSONObject> specs = new ArrayList<>();
      JSONObject completed = state.optJSONObject("todayCompleted");
      String today = LocalDate.now().toString();

      JSONObject responsibilities = state.optJSONObject("responsibilities");
      if (responsibilities != null) {
        Iterator<String> keys = responsibilities.keys();
        while (keys.hasNext()) {
          String id = keys.next();
          JSONObject record = responsibilities.optJSONObject(id);
          if (record == null) continue;
          boolean completedToday = completed != null && completed.optBoolean(id + "::" + today, false);
          specs.addAll(specsForResponsibility(record, completedToday));
        }
      }

      JSONObject dashboard = state.optJSONObject("dashboard");
      JSONObject routines = dashboard == null ? null : dashboard.optJSONObject("routines");
      if (routines != null) {
        Iterator<String> keys = routines.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          JSONObject routine = routines.optJSONObject(key);
          if (routine != null) specs.addAll(specsForRoutine(key, routine));
        }
      }

      SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      Set<String> scheduled = new HashSet<>();
      SharedPreferences.Editor editor = prefs.edit();
      for (JSONObject spec : specs) {
        String key = spec.getString("key");
        scheduled.add(key);
        editor.putString(SPEC_PREFIX + key, spec.toString());
      }
      editor.putStringSet(KEY_SET, scheduled).apply();
      for (JSONObject spec : specs) scheduleNext(context, spec, ZonedDateTime.now());
    } catch (Exception ignored) {
      // Invalid or incomplete tester data must never break the app.
    }
  }

  public static void restore(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    Set<String> keys = new HashSet<>(prefs.getStringSet(KEY_SET, Collections.emptySet()));
    for (String key : keys) {
      String json = prefs.getString(SPEC_PREFIX + key, null);
      if (json == null) continue;
      try { scheduleNext(context, new JSONObject(json), ZonedDateTime.now()); }
      catch (Exception ignored) {}
    }
  }

  public static void reminderFired(Context context, String key) {
    if (key == null) return;
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String json = prefs.getString(SPEC_PREFIX + key, null);
    if (json == null) return;
    try {
      JSONObject spec = new JSONObject(json);
      if ("once".equals(spec.optString("kind"))) {
        removeSpec(context, key);
      } else {
        scheduleNext(context, spec, ZonedDateTime.now().plusMinutes(1));
      }
    } catch (Exception ignored) {}
  }

  private static void removeSpec(Context context, String key) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    Set<String> keys = new HashSet<>(prefs.getStringSet(KEY_SET, Collections.emptySet()));
    keys.remove(key);
    prefs.edit().remove(SPEC_PREFIX + key).putStringSet(KEY_SET, keys).apply();
  }

  private static void clearAll(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    Set<String> keys = new HashSet<>(prefs.getStringSet(KEY_SET, Collections.emptySet()));
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms != null) {
      for (String key : keys) alarms.cancel(pendingIntent(context, key));
    }
    SharedPreferences.Editor editor = prefs.edit();
    for (String key : keys) editor.remove(SPEC_PREFIX + key);
    editor.remove(KEY_SET).apply();
  }

  private static List<JSONObject> specsForResponsibility(JSONObject r, boolean completedToday) {
    List<JSONObject> out = new ArrayList<>();
    String id = r.optString("id", r.optString("sourceName", "responsibility"));
    String title = r.optString("title", r.optString("sourceName", "My Life"));
    String date = r.optString("date", "");
    String created = r.optString("createdDate", LocalDate.now().toString());
    String repeat = r.optString("repeat", "");
    String schedule = r.optString("schedule", "");
    String choice = r.optString("scheduleChoice", "");
    String cadence = !repeat.isEmpty() ? repeat : schedule;
    int reminderDays = ReminderTimeCalculator.parseReminderDays(r.optString("reminder", ""));
    boolean yearly = r.optBoolean("yearly", false) || lower(cadence).contains("year");

    List<int[]> times = timesForRecord(r, choice);
    JSONArray specificDays = r.optJSONArray("specificDays");
    Set<DayOfWeek> weekdays = weekdays(specificDays);

    String kind;
    int interval = 1;
    LocalDate anchor = parseDate(!date.isEmpty() ? date : created);
    String lc = lower(cadence);

    if (!weekdays.isEmpty()) {
      kind = "weekdays";
    } else if (yearly) {
      kind = "yearly";
    } else if (lc.matches(".*every\\s+\\d+\\s+months?.*")) {
      kind = "months"; interval = parseInterval(lc, "months", 1);
    } else if (lc.contains("month")) {
      kind = "months";
    } else if (lc.matches(".*every\\s+\\d+\\s+weeks?.*")) {
      kind = "days"; interval = parseInterval(lc, "weeks", 1) * 7;
    } else if (lc.contains("two week") || lc.contains("2 week")) {
      kind = "days"; interval = 14;
    } else if (lc.contains("three week") || lc.contains("3 week")) {
      kind = "days"; interval = 21;
    } else if (lc.contains("week")) {
      kind = "days"; interval = 7;
    } else if (lc.matches(".*every\\s+\\d+\\s+days?.*")) {
      kind = "days"; interval = parseInterval(lc, "days", 1);
    } else if (lc.contains("daily") || isDailyChoice(choice)) {
      kind = "daily";
    } else if (!date.isEmpty()) {
      kind = "once";
    } else {
      String dueDay = r.optString("dueDay", "");
      if (!dueDay.isEmpty() && lc.contains("month")) {
        kind = "months";
        try {
          LocalDate c = parseDate(created);
          int day = Math.max(1, Math.min(31, Integer.parseInt(dueDay)));
          anchor = ReminderTimeCalculator.safeDate(c.getYear(), c.getMonthValue(), day);
        } catch (Exception ignored) {}
      } else {
        return out; // A custom text-only schedule cannot be safely guessed.
      }
    }

    if (anchor == null && !"daily".equals(kind) && !"weekdays".equals(kind)) {
      anchor = LocalDate.now();
    }
    if (completedToday && !"once".equals(kind)) {
      // Move the scheduling reference beyond today so a completed daily item stays quiet.
      created = LocalDate.now().plusDays(1).toString();
      if (anchor != null && !anchor.isAfter(LocalDate.now())) anchor = LocalDate.now().plusDays(1);
    }

    int index = 0;
    for (int[] hm : times) {
      JSONObject spec = baseSpec(id + (times.size() > 1 ? "#" + index : ""), title,
          "My Life reminder", kind, anchor, hm[0], hm[1], interval, reminderDays);
      if (!weekdays.isEmpty()) spec.put("weekdays", weekdayCsv(weekdays));
      out.add(spec);
      index++;
    }
    return out;
  }

  private static List<JSONObject> specsForRoutine(String key, JSONObject routine) {
    List<JSONObject> out = new ArrayList<>();
    String title = routine.optString("detail", "My Life routine");
    JSONObject fields = routine.optJSONObject("fields");
    if (fields == null) fields = new JSONObject();
    JSONArray options = routine.optJSONArray("options");
    String optionText = lower(options == null ? "" : options.toString());
    String date = fields.optString("date", "");
    int reminderDays = 0;
    try { reminderDays = Math.max(0, Integer.parseInt(fields.optString("reminderDays", "0"))); }
    catch (Exception ignored) {}
    LocalDate anchor = parseDate(date);
    String kind = null;
    int interval = 1;
    Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);

    String day = fields.optString("day", "");
    if (!day.isEmpty()) {
      try { days.add(DayOfWeek.valueOf(day.trim().toUpperCase(Locale.US))); } catch (Exception ignored) {}
      if (!days.isEmpty()) kind = "weekdays";
    }
    if (kind == null && !date.isEmpty()) {
      kind = optionText.contains("repeat yearly") ? "yearly" : "once";
    }
    if (kind == null && optionText.contains("daily routine")) kind = "daily";
    if (kind == null && (optionText.contains("weekly routine") || optionText.contains("weekly focus"))) {
      kind = "days"; interval = 7; anchor = LocalDate.now();
    }
    if (kind == null && optionText.contains("monthly check-in")) {
      kind = "months"; anchor = LocalDate.now();
    }
    if (kind == null) return out;

    JSONObject spec = baseSpec("routine::" + key, title, "My Life routine", kind,
        anchor, DEFAULT_HOUR, 0, interval, reminderDays);
    if (!days.isEmpty()) spec.put("weekdays", weekdayCsv(days));
    out.add(spec);
    return out;
  }

  private static JSONObject baseSpec(String key, String title, String message, String kind,
      LocalDate anchor, int hour, int minute, int interval, int offsetDays) {
    JSONObject o = new JSONObject();
    o.put("key", key);
    o.put("title", title);
    o.put("message", message);
    o.put("kind", kind);
    if (anchor != null) o.put("anchor", anchor.toString());
    o.put("hour", hour);
    o.put("minute", minute);
    o.put("interval", Math.max(1, interval));
    o.put("offsetDays", Math.max(0, offsetDays));
    return o;
  }

  private static void scheduleNext(Context context, JSONObject spec, ZonedDateTime now) {
    ZonedDateTime fire = nextFire(spec, now);
    if (fire == null) return;
    AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (alarms == null) return;
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fire.toInstant().toEpochMilli(),
        pendingIntent(context, spec.optString("key")));
  }

  private static ZonedDateTime nextFire(JSONObject spec, ZonedDateTime now) {
    String kind = spec.optString("kind", "");
    int hour = spec.optInt("hour", DEFAULT_HOUR);
    int minute = spec.optInt("minute", 0);
    int interval = Math.max(1, spec.optInt("interval", 1));
    int offset = Math.max(0, spec.optInt("offsetDays", 0));
    LocalDate anchor = parseDate(spec.optString("anchor", ""));
    ZonedDateTime shiftedNow = offset == 0 ? now : now.plusDays(offset);
    ZonedDateTime due;
    switch (kind) {
      case "once":
        return ReminderTimeCalculator.nextOneTime(now, anchor, hour, minute, offset).orElse(null);
      case "daily":
        due = ReminderTimeCalculator.nextDaily(shiftedNow, hour, minute); break;
      case "weekdays":
        due = ReminderTimeCalculator.nextOnWeekdays(shiftedNow,
            parseWeekdays(spec.optString("weekdays", "")), hour, minute); break;
      case "days":
        due = ReminderTimeCalculator.nextEveryDays(shiftedNow, anchor, interval, hour, minute); break;
      case "months":
        due = ReminderTimeCalculator.nextEveryMonths(shiftedNow, anchor, interval, hour, minute); break;
      case "yearly":
        due = ReminderTimeCalculator.nextYearly(shiftedNow, anchor, hour, minute); break;
      default:
        return null;
    }
    return offset == 0 ? due : due.minusDays(offset);
  }

  private static PendingIntent pendingIntent(Context context, String key) {
    Intent intent = new Intent(context, ReminderReceiver.class)
        .setAction("com.osulsa.mylife.REMINDER." + key)
        .putExtra("key", key);
    return PendingIntent.getBroadcast(context, key.hashCode(), intent,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private static List<int[]> timesForRecord(JSONObject r, String choice) {
    List<int[]> times = new ArrayList<>();
    JSONArray specific = r.optJSONArray("specificTimes");
    if (specific != null) {
      for (int i = 0; i < specific.length(); i++) {
        int[] hm = parseTime(specific.optString(i, ""));
        if (hm != null) times.add(hm);
      }
    }
    if (!times.isEmpty()) return times;
    int[] appointment = parseTime(r.optString("time", ""));
    if (appointment != null) { times.add(appointment); return times; }
    if ("Morning & Evening".equals(choice)) { times.add(new int[]{8,0}); times.add(new int[]{19,0}); }
    else if ("Morning".equals(choice)) times.add(new int[]{8,0});
    else if ("Evening".equals(choice)) times.add(new int[]{19,0});
    else times.add(new int[]{DEFAULT_HOUR,0});
    return times;
  }

  private static boolean isDailyChoice(String choice) {
    return "Morning".equals(choice) || "Evening".equals(choice) ||
        "Morning & Evening".equals(choice) || "Specific Times".equals(choice) ||
        "Daily".equals(choice) || "Weekdays".equals(choice);
  }

  private static int parseInterval(String text, String unit, int fallback) {
    Matcher m = Pattern.compile("every\\s+(\\d+)\\s+" + unit.substring(0, unit.length()-1) + "s?",
        Pattern.CASE_INSENSITIVE).matcher(text);
    return m.find() ? Math.max(1, Integer.parseInt(m.group(1))) : fallback;
  }

  private static LocalDate parseDate(String value) {
    try { return value == null || value.isEmpty() ? null : LocalDate.parse(value); }
    catch (Exception e) { return null; }
  }

  private static int[] parseTime(String value) {
    if (value == null || value.isEmpty()) return null;
    try {
      String[] parts = value.split(":");
      return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1])};
    } catch (Exception e) { return null; }
  }

  private static Set<DayOfWeek> weekdays(JSONArray array) {
    Set<DayOfWeek> out = EnumSet.noneOf(DayOfWeek.class);
    if (array == null) return out;
    for (int i = 0; i < array.length(); i++) {
      try { out.add(DayOfWeek.valueOf(array.optString(i).toUpperCase(Locale.US))); }
      catch (Exception ignored) {}
    }
    return out;
  }

  private static String weekdayCsv(Set<DayOfWeek> days) {
    StringBuilder b = new StringBuilder();
    for (DayOfWeek d : days) { if (b.length() > 0) b.append(','); b.append(d.name()); }
    return b.toString();
  }

  private static Set<DayOfWeek> parseWeekdays(String csv) {
    Set<DayOfWeek> out = EnumSet.noneOf(DayOfWeek.class);
    for (String part : csv.split(",")) {
      try { if (!part.isEmpty()) out.add(DayOfWeek.valueOf(part)); } catch (Exception ignored) {}
    }
    return out;
  }

  private static String lower(String value) { return value == null ? "" : value.toLowerCase(Locale.US); }
}
