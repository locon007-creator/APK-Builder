package com.osulsa.apkbuilder.engine;

import java.util.*;

public final class TemplateContractParser {
  private TemplateContractParser() {}

  private static final Set<String> KEYS = Set.of(
      "contractVersion", "templateVersion", "templateFile", "sha256",
      "minimumBuilderVersion", "packageSkeleton", "requiredEntries", "capabilities");
  private static final Set<String> CAPABILITIES = Set.of(
      "notifications", "reminders", "background_work", "location", "camera", "microphone",
      "bluetooth", "file_media_access", "vibration");

  public static TemplateContract parse(String json) throws TemplateException {
    if (json == null || json.isBlank()) throw invalid("Template contract is empty");
    try {
      Object root = new Json(json).parse();
      if (!(root instanceof Map<?, ?> raw)) throw invalid("Template contract must be an object");
      Map<String, Object> map = new LinkedHashMap<>();
      for (Map.Entry<?, ?> e : raw.entrySet()) {
        if (!(e.getKey() instanceof String key)) throw invalid("Contract key must be a string");
        if (!KEYS.contains(key)) throw invalid("Unknown contract field: " + key);
        map.put(key, e.getValue());
      }
      for (String key : KEYS) if (!map.containsKey(key)) throw invalid("Missing contract field: " + key);
      int version = asInt(map.get("contractVersion"), "contractVersion");
      String templateVersion = asString(map.get("templateVersion"), "templateVersion");
      String templateFile = asString(map.get("templateFile"), "templateFile");
      String sha256 = asString(map.get("sha256"), "sha256");
      String minBuilder = asString(map.get("minimumBuilderVersion"), "minimumBuilderVersion");
      String skeleton = asString(map.get("packageSkeleton"), "packageSkeleton");
      List<String> entries = asStringList(map.get("requiredEntries"), "requiredEntries");
      List<String> capabilities = asStringList(map.get("capabilities"), "capabilities");

      if (version != 1) throw invalid("Unsupported contract version: " + version);
      if (!"template/webview_shell.apk".equals(templateFile)) throw invalid("Unexpected templateFile");
      if (!sha256.matches("[a-fA-F0-9]{64}")) throw invalid("sha256 must be 64 hex characters");
      if (entries.size() < 3 || new HashSet<>(entries).size() != entries.size()) throw invalid("requiredEntries invalid");
      for (String required : List.of("AndroidManifest.xml", "resources.arsc", "classes.dex")) {
        if (!entries.contains(required)) throw invalid("requiredEntries missing " + required);
      }
      if (new HashSet<>(capabilities).size() != capabilities.size()) throw invalid("duplicate capability");
      for (String c : capabilities) if (!CAPABILITIES.contains(c)) throw invalid("Unknown capability: " + c);
      return new TemplateContract(version, templateVersion, templateFile, sha256.toLowerCase(Locale.ROOT),
          minBuilder, skeleton, List.copyOf(entries), List.copyOf(capabilities));
    } catch (TemplateException e) {
      throw e;
    } catch (RuntimeException e) {
      throw new TemplateException(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, "Invalid template contract", e);
    }
  }

  private static TemplateException invalid(String message) {
    return new TemplateException(TemplateErrorCode.TEMPLATE_CONTRACT_INVALID, message);
  }
  private static int asInt(Object value, String field) throws TemplateException {
    if (value instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) return n.intValue();
    throw invalid(field + " must be an integer");
  }
  private static String asString(Object value, String field) throws TemplateException {
    if (value instanceof String s && !s.isBlank()) return s;
    throw invalid(field + " must be a non-empty string");
  }
  private static List<String> asStringList(Object value, String field) throws TemplateException {
    if (!(value instanceof List<?> list)) throw invalid(field + " must be an array");
    List<String> out = new ArrayList<>();
    for (Object item : list) {
      if (!(item instanceof String s) || s.isBlank()) throw invalid(field + " must contain strings");
      out.add(s);
    }
    return out;
  }

  private static final class Json {
    private final String text; private int p;
    Json(String text) { this.text = text; }
    Object parse() {
      ws(); Object v = value(); ws(); if (p != text.length()) fail(); return v;
    }
    private Object value() {
      ws(); if (p >= text.length()) fail(); char c = text.charAt(p);
      if (c == '{') return object(); if (c == '[') return array(); if (c == '"') return string();
      if (c == '-' || Character.isDigit(c)) return number(); if (text.startsWith("true", p)) { p += 4; return Boolean.TRUE; }
      if (text.startsWith("false", p)) { p += 5; return Boolean.FALSE; } if (text.startsWith("null", p)) { p += 4; return null; }
      fail(); return null;
    }
    private Map<String,Object> object() {
      expect('{'); ws(); Map<String,Object> m = new LinkedHashMap<>(); if (take('}')) return m;
      while (true) { ws(); String k = string(); ws(); expect(':'); Object v = value(); if (m.put(k,v) != null) fail(); ws(); if (take('}')) return m; expect(','); }
    }
    private List<Object> array() {
      expect('['); ws(); List<Object> a = new ArrayList<>(); if (take(']')) return a;
      while (true) { a.add(value()); ws(); if (take(']')) return a; expect(','); }
    }
    private String string() {
      expect('"'); StringBuilder s = new StringBuilder();
      while (p < text.length()) { char c = text.charAt(p++); if (c == '"') return s.toString();
        if (c == '\\') { if (p >= text.length()) fail(); char e = text.charAt(p++); switch (e) {
          case '"','\\','/' -> s.append(e); case 'b' -> s.append('\b'); case 'f' -> s.append('\f'); case 'n' -> s.append('\n'); case 'r' -> s.append('\r'); case 't' -> s.append('\t');
          case 'u' -> { if (p + 4 > text.length()) fail(); s.append((char)Integer.parseInt(text.substring(p,p+4),16)); p += 4; }
          default -> fail(); }
        } else { if (c < 0x20) fail(); s.append(c); }
      } fail(); return null;
    }
    private Number number() {
      int start = p; if (take('-')) {} while (p < text.length() && Character.isDigit(text.charAt(p))) p++;
      if (take('.')) while (p < text.length() && Character.isDigit(text.charAt(p))) p++;
      if (p < text.length() && (text.charAt(p)=='e' || text.charAt(p)=='E')) { p++; if (p < text.length() && (text.charAt(p)=='+' || text.charAt(p)=='-')) p++; while (p < text.length() && Character.isDigit(text.charAt(p))) p++; }
      String n = text.substring(start,p); return (n.contains(".") || n.contains("e") || n.contains("E")) ? Double.parseDouble(n) : Long.parseLong(n);
    }
    private void ws() { while (p < text.length() && Character.isWhitespace(text.charAt(p))) p++; }
    private boolean take(char c) { if (p < text.length() && text.charAt(p)==c) { p++; return true; } return false; }
    private void expect(char c) { if (!take(c)) fail(); }
    private void fail() { throw new IllegalArgumentException("Invalid JSON near offset " + p); }
  }
}
