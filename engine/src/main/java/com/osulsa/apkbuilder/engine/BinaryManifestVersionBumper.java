package com.osulsa.apkbuilder.engine;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Reads an APK binary manifest and changes only android:versionCode in place. */
public final class BinaryManifestVersionBumper {
  private BinaryManifestVersionBumper() {}

  private static final int CHUNK_XML = 0x0003;
  private static final int CHUNK_STRING_POOL = 0x0001;
  private static final int CHUNK_RESOURCE_MAP = 0x0180;
  private static final int CHUNK_START_ELEMENT = 0x0102;
  private static final int ATTR_VERSION_CODE = 0x0101021b;
  private static final int TYPE_STRING = 0x03;
  private static final int TYPE_INT_DEC = 0x10;

  public record ManifestInfo(String packageName, int versionCode) {}

  public static ManifestInfo inspect(byte[] axml) throws TemplateException {
    Parsed parsed = parse(axml);
    Location location = locate(parsed, axml);
    return new ManifestInfo(location.packageName, location.versionCode);
  }

  public static byte[] bumpVersionCode(byte[] axml) throws TemplateException {
    Parsed parsed = parse(axml);
    Location location = locate(parsed, axml);
    if (location.versionCode == Integer.MAX_VALUE) {
      throw failure("AndroidManifest.xml versionCode cannot be incremented", null);
    }
    byte[] updated = axml.clone();
    putInt(updated, location.versionValueOffset, location.versionCode + 1);
    ManifestInfo after = inspect(updated);
    if (!after.packageName().equals(location.packageName) || after.versionCode() != location.versionCode + 1) {
      throw failure("AndroidManifest.xml version update verification failed", null);
    }
    return updated;
  }

  private static Location locate(Parsed parsed, byte[] data) throws TemplateException {
    int versionCodeName = -1;
    if (parsed.resourceMap != null) {
      for (int i = 0; i < parsed.resourceMap.length; i++) {
        if (parsed.resourceMap[i] == ATTR_VERSION_CODE) {
          versionCodeName = i;
          break;
        }
      }
    }
    if (versionCodeName < 0) throw failure("AndroidManifest.xml has no versionCode resource", null);

    ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
    int offset = parsed.headerSize;
    String packageName = null;
    Integer versionCode = null;
    int versionValueOffset = -1;

    while (offset < data.length) {
      int type = getU16(data, offset);
      int header = getU16(data, offset + 2);
      int size = getInt(data, offset + 4);
      if (type == CHUNK_START_ELEMENT) {
        if (header < 16 || size < 36) throw failure("AndroidManifest.xml has a malformed element", null);
        int elementNameIndex = getInt(data, offset + 20);
        String element = stringAt(parsed.strings, elementNameIndex);
        if ("manifest".equals(element)) {
          int attrStart = getU16(data, offset + 24);
          int attrSize = getU16(data, offset + 26);
          int attrCount = getU16(data, offset + 28);
          if (attrSize < 20) throw failure("AndroidManifest.xml has malformed attributes", null);
          int first = offset + 16 + attrStart;
          for (int i = 0; i < attrCount; i++) {
            int attr = first + i * attrSize;
            if (attr < offset || attr + 20 > offset + size) throw failure("AndroidManifest.xml attribute escapes its element", null);
            int nameIndex = getInt(data, attr + 4);
            int valueType = data[attr + 15] & 0xff;
            int valueData = b.getInt(attr + 16);
            String name = stringAt(parsed.strings, nameIndex);
            if ("package".equals(name) && valueType == TYPE_STRING) {
              packageName = stringAt(parsed.strings, valueData);
            }
            if (nameIndex == versionCodeName && valueType == TYPE_INT_DEC) {
              versionCode = valueData;
              versionValueOffset = attr + 16;
            }
          }
          break;
        }
      }
      offset += size;
    }
    if (packageName == null || packageName.isBlank()) throw failure("AndroidManifest.xml package name is missing", null);
    if (versionCode == null || versionCode <= 0 || versionValueOffset < 0) throw failure("AndroidManifest.xml versionCode is missing or invalid", null);
    return new Location(packageName, versionCode, versionValueOffset);
  }

  private static Parsed parse(byte[] data) throws TemplateException {
    if (data == null || data.length < 8) throw failure("AndroidManifest.xml is not binary AXML", null);
    int type = getU16(data, 0);
    int headerSize = getU16(data, 2);
    int declared = getInt(data, 4);
    if (type != CHUNK_XML || headerSize < 8 || headerSize > data.length || declared != data.length) {
      throw failure("AndroidManifest.xml has an invalid AXML header", null);
    }

    List<String> strings = null;
    int[] resourceMap = null;
    int offset = headerSize;
    while (offset < data.length) {
      if (offset + 8 > data.length) throw failure("AndroidManifest.xml has a truncated chunk", null);
      int chunkType = getU16(data, offset);
      int chunkHeader = getU16(data, offset + 2);
      int chunkSize = getInt(data, offset + 4);
      if (chunkHeader < 8 || chunkSize < chunkHeader || offset + chunkSize > data.length) {
        throw failure("AndroidManifest.xml has an invalid chunk", null);
      }
      if (chunkType == CHUNK_STRING_POOL) strings = parseStringPool(data, offset, chunkHeader, chunkSize);
      else if (chunkType == CHUNK_RESOURCE_MAP) resourceMap = parseResourceMap(data, offset, chunkSize);
      offset += chunkSize;
    }
    if (strings == null) throw failure("AndroidManifest.xml has no string pool", null);
    return new Parsed(headerSize, strings, resourceMap);
  }

  private static List<String> parseStringPool(byte[] data, int offset, int headerSize, int chunkSize) throws TemplateException {
    if (headerSize < 28 || offset + 28 > data.length) throw failure("AndroidManifest.xml string pool header is invalid", null);
    int stringCount = getInt(data, offset + 8);
    int styleCount = getInt(data, offset + 12);
    int flags = getInt(data, offset + 16);
    int stringsStart = getInt(data, offset + 20);
    if (stringCount < 0 || styleCount < 0 || stringsStart < headerSize) throw failure("AndroidManifest.xml string pool is invalid", null);
    long offsetTableEnd = (long) offset + headerSize + (long) (stringCount + styleCount) * 4L;
    if (offsetTableEnd > (long) offset + chunkSize) throw failure("AndroidManifest.xml string offsets are truncated", null);
    boolean utf8 = (flags & 0x100) != 0;
    List<String> result = new ArrayList<>(stringCount);
    int table = offset + headerSize;
    int dataStart = offset + stringsStart;
    for (int i = 0; i < stringCount; i++) {
      int relative = getInt(data, table + i * 4);
      int stringOffset = dataStart + relative;
      if (relative < 0 || stringOffset < dataStart || stringOffset >= offset + chunkSize) throw failure("AndroidManifest.xml string offset is invalid", null);
      result.add(utf8 ? readUtf8(data, stringOffset, offset + chunkSize) : readUtf16(data, stringOffset, offset + chunkSize));
    }
    return result;
  }

  private static int[] parseResourceMap(byte[] data, int offset, int chunkSize) throws TemplateException {
    if ((chunkSize - 8) % 4 != 0) throw failure("AndroidManifest.xml resource map is malformed", null);
    int count = (chunkSize - 8) / 4;
    int[] map = new int[count];
    for (int i = 0; i < count; i++) map[i] = getInt(data, offset + 8 + i * 4);
    return map;
  }

  private static String readUtf8(byte[] data, int offset, int limit) throws TemplateException {
    Cursor c = new Cursor(offset);
    readLength8(data, c, limit);
    int byteLength = readLength8(data, c, limit);
    if (byteLength < 0 || c.value + byteLength >= limit) throw failure("AndroidManifest.xml UTF-8 string is truncated", null);
    String value = new String(data, c.value, byteLength, StandardCharsets.UTF_8);
    if (data[c.value + byteLength] != 0) throw failure("AndroidManifest.xml UTF-8 string is unterminated", null);
    return value;
  }

  private static int readLength8(byte[] data, Cursor c, int limit) throws TemplateException {
    if (c.value >= limit) throw failure("AndroidManifest.xml UTF-8 length is truncated", null);
    int first = data[c.value++] & 0xff;
    if ((first & 0x80) == 0) return first;
    if (c.value >= limit) throw failure("AndroidManifest.xml UTF-8 length is truncated", null);
    return ((first & 0x7f) << 8) | (data[c.value++] & 0xff);
  }

  private static String readUtf16(byte[] data, int offset, int limit) throws TemplateException {
    Cursor c = new Cursor(offset);
    int length = readLength16(data, c, limit);
    long bytes = (long) length * 2L;
    if (bytes > Integer.MAX_VALUE || c.value + bytes + 2L > limit) throw failure("AndroidManifest.xml UTF-16 string is truncated", null);
    String value = new String(data, c.value, (int) bytes, StandardCharsets.UTF_16LE);
    int end = c.value + (int) bytes;
    if (data[end] != 0 || data[end + 1] != 0) throw failure("AndroidManifest.xml UTF-16 string is unterminated", null);
    return value;
  }

  private static int readLength16(byte[] data, Cursor c, int limit) throws TemplateException {
    if (c.value + 2 > limit) throw failure("AndroidManifest.xml UTF-16 length is truncated", null);
    int first = getU16(data, c.value); c.value += 2;
    if ((first & 0x8000) == 0) return first;
    if (c.value + 2 > limit) throw failure("AndroidManifest.xml UTF-16 length is truncated", null);
    int second = getU16(data, c.value); c.value += 2;
    return ((first & 0x7fff) << 16) | second;
  }

  private static String stringAt(List<String> strings, int index) throws TemplateException {
    if (index < 0 || index >= strings.size()) throw failure("AndroidManifest.xml string index is invalid", null);
    return strings.get(index);
  }

  private static int getU16(byte[] data, int offset) throws TemplateException {
    if (offset < 0 || offset + 2 > data.length) throw failure("AndroidManifest.xml is truncated", null);
    return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8);
  }

  private static int getInt(byte[] data, int offset) throws TemplateException {
    if (offset < 0 || offset + 4 > data.length) throw failure("AndroidManifest.xml is truncated", null);
    return (data[offset] & 0xff) | ((data[offset + 1] & 0xff) << 8) | ((data[offset + 2] & 0xff) << 16) | (data[offset + 3] << 24);
  }

  private static void putInt(byte[] data, int offset, int value) throws TemplateException {
    if (offset < 0 || offset + 4 > data.length) throw failure("AndroidManifest.xml versionCode offset is invalid", null);
    data[offset] = (byte) value;
    data[offset + 1] = (byte) (value >>> 8);
    data[offset + 2] = (byte) (value >>> 16);
    data[offset + 3] = (byte) (value >>> 24);
  }

  private static TemplateException failure(String message, Throwable cause) {
    return cause == null
        ? new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, message)
        : new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, message, cause);
  }

  private record Parsed(int headerSize, List<String> strings, int[] resourceMap) {}
  private record Location(String packageName, int versionCode, int versionValueOffset) {}
  private static final class Cursor { int value; Cursor(int value) { this.value = value; } }
}
