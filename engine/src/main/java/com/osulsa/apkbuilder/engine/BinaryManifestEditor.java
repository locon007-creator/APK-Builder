package com.osulsa.apkbuilder.engine;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Minimal deterministic binary AndroidManifest.xml identity editor. */
public final class BinaryManifestEditor {
  private BinaryManifestEditor() {}

  private static final int CHUNK_XML = 0x0003;
  private static final int CHUNK_STRING_POOL = 0x0001;
  private static final int CHUNK_RESOURCE_MAP = 0x0180;
  private static final int CHUNK_START_ELEMENT = 0x0102;
  private static final int ATTR_NAME = 0x01010003;
  private static final int ATTR_VERSION_CODE = 0x0101021b;
  private static final int ATTR_VERSION_NAME = 0x0101021c;
  private static final int ATTR_LABEL = 0x01010001;
  private static final int TYPE_STRING = 0x03;
  private static final int TYPE_INT_DEC = 0x10;

  public static byte[] patch(byte[] axml, String originalPackage, AppIdentity identity) throws TemplateException {
    if (identity == null || originalPackage == null || originalPackage.isBlank()) {
      throw failure("Manifest identity input is missing", null);
    }
    try {
      Parsed parsed = parse(axml);
      expandRelativeComponentNames(parsed, originalPackage);
      replacePackageStrings(parsed, originalPackage, identity.packageName());
      patchManifestVersion(parsed, identity.versionCode(), identity.versionName());
      patchApplicationLabel(parsed, identity.appName());
      byte[] result = rebuild(parsed);
      verifyIdentity(result, identity);
      return result;
    } catch (TemplateException e) {
      throw e;
    } catch (RuntimeException e) {
      throw failure("Could not patch binary AndroidManifest.xml", e);
    }
  }

  public static void verifyIdentity(byte[] axml, AppIdentity identity) throws TemplateException {
    Parsed parsed = parse(axml);
    boolean packageFound = false;
    boolean versionCodeFound = false;
    boolean versionNameFound = false;
    boolean labelFound = false;
    int versionCodeName = resourceIndex(parsed, ATTR_VERSION_CODE);
    int versionNameName = resourceIndex(parsed, ATTR_VERSION_NAME);
    int labelName = resourceIndex(parsed, ATTR_LABEL);
    for (Chunk chunk : parsed.chunks) {
      if (chunk.type != CHUNK_START_ELEMENT) continue;
      String element = elementName(parsed, chunk);
      if (element == null) continue;
      AttrTable table = attributes(chunk);
      for (int i = 0; i < table.count; i++) {
        int off = table.first + i * table.size;
        int name = getInt(chunk.data, off + 4);
        int type = chunk.data[off + 15] & 0xff;
        int data = getInt(chunk.data, off + 16);
        if ("manifest".equals(element) && "package".equals(stringAt(parsed, name)) && type == TYPE_STRING && identity.packageName().equals(stringAt(parsed, data))) packageFound = true;
        if ("manifest".equals(element) && name == versionCodeName && type == TYPE_INT_DEC && data == identity.versionCode()) versionCodeFound = true;
        if ("manifest".equals(element) && name == versionNameName && type == TYPE_STRING && identity.versionName().equals(stringAt(parsed, data))) versionNameFound = true;
        if ("application".equals(element) && name == labelName && type == TYPE_STRING && identity.appName().equals(stringAt(parsed, data))) labelFound = true;
      }
    }
    if (!packageFound || !versionCodeFound || !versionNameFound || !labelFound) {
      throw failure("Manifest identity verification failed", null);
    }
  }

  private static void expandRelativeComponentNames(Parsed parsed, String originalPackage) throws TemplateException {
    int nameIndex = resourceIndex(parsed, ATTR_NAME);
    if (nameIndex < 0) return;
    Set<String> componentTags = Set.of("activity", "activity-alias", "service", "receiver", "provider", "application");
    for (Chunk chunk : parsed.chunks) {
      if (chunk.type != CHUNK_START_ELEMENT) continue;
      String element = elementName(parsed, chunk);
      if (!componentTags.contains(element)) continue;
      AttrTable table = attributes(chunk);
      for (int i = 0; i < table.count; i++) {
        int off = table.first + i * table.size;
        if (getInt(chunk.data, off + 4) != nameIndex || (chunk.data[off + 15] & 0xff) != TYPE_STRING) continue;
        int valueIndex = getInt(chunk.data, off + 16);
        String value = stringAt(parsed, valueIndex);
        if (value == null || value.isEmpty()) continue;
        String expanded = null;
        if (value.startsWith(".")) expanded = originalPackage + value;
        else if (!value.contains(".")) expanded = originalPackage + "." + value;
        if (expanded != null) {
          int newIndex = addString(parsed.pool, expanded);
          putInt(chunk.data, off + 8, newIndex);
          putInt(chunk.data, off + 16, newIndex);
        }
      }
    }
  }

  private static void replacePackageStrings(Parsed parsed, String oldPackage, String newPackage) {
    for (int i = 0; i < parsed.pool.strings.size(); i++) {
      String value = parsed.pool.strings.get(i);
      if (value.equals(oldPackage)) {
        parsed.pool.strings.set(i, newPackage);
      } else if (value.startsWith(oldPackage + ".")) {
        String suffix = value.substring(oldPackage.length() + 1);
        if (!isLikelyClassName(suffix)) {
          parsed.pool.strings.set(i, newPackage + value.substring(oldPackage.length()));
        }
      }
    }
  }

  private static boolean isLikelyClassName(String suffix) {
    String last = suffix.substring(suffix.lastIndexOf('.') + 1);
    if (last.isEmpty() || !Character.isUpperCase(last.charAt(0))) return false;
    if (last.matches("[A-Z][A-Za-z0-9_$]*")) return true;
    for (String ending : List.of("Activity", "Service", "Provider", "Receiver", "Application", "Fragment", "Adapter", "View", "Manager", "Helper")) {
      if (last.endsWith(ending)) return true;
    }
    return false;
  }

  private static void patchManifestVersion(Parsed parsed, int versionCode, String versionName) throws TemplateException {
    int versionCodeIndex = resourceIndex(parsed, ATTR_VERSION_CODE);
    int versionNameIndex = resourceIndex(parsed, ATTR_VERSION_NAME);
    if (versionCodeIndex < 0 || versionNameIndex < 0) throw failure("Manifest version attributes are missing from resource map", null);
    boolean codePatched = false;
    boolean namePatched = false;
    for (Chunk chunk : parsed.chunks) {
      if (chunk.type != CHUNK_START_ELEMENT || !"manifest".equals(elementName(parsed, chunk))) continue;
      AttrTable table = attributes(chunk);
      for (int i = 0; i < table.count; i++) {
        int off = table.first + i * table.size;
        int name = getInt(chunk.data, off + 4);
        if (name == versionCodeIndex) {
          setTypedInt(chunk.data, off, versionCode);
          codePatched = true;
        } else if (name == versionNameIndex) {
          int str = addString(parsed.pool, versionName);
          setTypedString(chunk.data, off, str);
          namePatched = true;
        }
      }
      break;
    }
    if (!codePatched || !namePatched) throw failure("Manifest version attributes could not be patched", null);
  }

  private static void patchApplicationLabel(Parsed parsed, String label) throws TemplateException {
    int labelIndex = resourceIndex(parsed, ATTR_LABEL);
    if (labelIndex < 0) throw failure("android:label is missing from resource map", null);
    int str = addString(parsed.pool, label);
    for (Chunk chunk : parsed.chunks) {
      if (chunk.type != CHUNK_START_ELEMENT || !"application".equals(elementName(parsed, chunk))) continue;
      AttrTable table = attributes(chunk);
      for (int i = 0; i < table.count; i++) {
        int off = table.first + i * table.size;
        if (getInt(chunk.data, off + 4) == labelIndex) {
          setTypedString(chunk.data, off, str);
          return;
        }
      }
      break;
    }
    throw failure("Application label attribute could not be patched", null);
  }

  private static void setTypedInt(byte[] data, int off, int value) {
    putInt(data, off + 8, -1);
    putShort(data, off + 12, 8);
    data[off + 14] = 0;
    data[off + 15] = (byte) TYPE_INT_DEC;
    putInt(data, off + 16, value);
  }

  private static void setTypedString(byte[] data, int off, int stringIndex) {
    putInt(data, off + 8, stringIndex);
    putShort(data, off + 12, 8);
    data[off + 14] = 0;
    data[off + 15] = (byte) TYPE_STRING;
    putInt(data, off + 16, stringIndex);
  }

  private static Parsed parse(byte[] data) throws TemplateException {
    if (data == null || data.length < 8) throw failure("AndroidManifest.xml is not binary AXML", null);
    try {
      ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
      int type = b.getShort(0) & 0xffff;
      int headerSize = b.getShort(2) & 0xffff;
      int declaredSize = b.getInt(4);
      if (type != CHUNK_XML || headerSize < 8 || headerSize > data.length || declaredSize != data.length) {
        throw failure("AndroidManifest.xml has an invalid AXML header", null);
      }
      StringPool pool = null;
      int[] resourceMap = null;
      List<Chunk> chunks = new ArrayList<>();
      int offset = headerSize;
      while (offset < data.length) {
        if (offset + 8 > data.length) throw failure("AndroidManifest.xml has a truncated chunk", null);
        int chunkType = b.getShort(offset) & 0xffff;
        int chunkHeader = b.getShort(offset + 2) & 0xffff;
        int size = b.getInt(offset + 4);
        if (chunkHeader < 8 || size < chunkHeader || offset + size > data.length) throw failure("AndroidManifest.xml has an invalid chunk", null);
        if (chunkType == CHUNK_STRING_POOL) pool = parsePool(data, offset, chunkHeader, size);
        else if (chunkType == CHUNK_RESOURCE_MAP) resourceMap = parseResourceMap(data, offset, size);
        else chunks.add(new Chunk(chunkType, Arrays.copyOfRange(data, offset, offset + size)));
        offset += size;
      }
      if (pool == null) throw failure("AndroidManifest.xml has no string pool", null);
      return new Parsed(headerSize, pool, resourceMap, chunks);
    } catch (TemplateException e) {
      throw e;
    } catch (IndexOutOfBoundsException | IllegalArgumentException e) {
      throw failure("AndroidManifest.xml is malformed", e);
    }
  }

  private static StringPool parsePool(byte[] data, int offset, int headerSize, int chunkSize) throws TemplateException {
    if (headerSize < 28 || offset + headerSize > data.length) throw failure("AXML string pool header is invalid", null);
    ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
    int count = b.getInt(offset + 8);
    int styleCount = b.getInt(offset + 12);
    int flags = b.getInt(offset + 16);
    int stringsStart = b.getInt(offset + 20);
    int stylesStart = b.getInt(offset + 24);
    if (count < 0 || styleCount < 0 || count > 200_000 || styleCount > 200_000) throw failure("AXML string pool count is invalid", null);
    long offsetsEnd = (long) offset + headerSize + (long) (count + styleCount) * 4L;
    if (offsetsEnd > offset + chunkSize) throw failure("AXML string pool offsets are truncated", null);
    int[] offsets = new int[count];
    int cursor = offset + headerSize;
    for (int i = 0; i < count; i++) { offsets[i] = b.getInt(cursor); cursor += 4; }
    int[] styleOffsets = new int[styleCount];
    for (int i = 0; i < styleCount; i++) { styleOffsets[i] = b.getInt(cursor); cursor += 4; }
    int stringsDataStart = offset + stringsStart;
    int stringsDataEnd = stylesStart > 0 ? offset + stylesStart : offset + chunkSize;
    if (stringsStart < headerSize || stringsDataStart < offset || stringsDataStart > stringsDataEnd || stringsDataEnd > offset + chunkSize) {
      throw failure("AXML string pool data range is invalid", null);
    }
    boolean utf8 = (flags & 0x100) != 0;
    List<String> strings = new ArrayList<>(count);
    for (int relative : offsets) {
      int p = stringsDataStart + relative;
      if (p < stringsDataStart || p >= stringsDataEnd) throw failure("AXML string offset is invalid", null);
      strings.add(utf8 ? readUtf8(data, p, stringsDataEnd) : readUtf16(data, p, stringsDataEnd));
    }
    byte[] styleData = styleCount > 0 && stylesStart > 0 ? Arrays.copyOfRange(data, offset + stylesStart, offset + chunkSize) : null;
    int originalStringsSize = stringsDataEnd - stringsDataStart;
    return new StringPool(flags, utf8, strings, styleOffsets, styleData, originalStringsSize);
  }

  private static int[] parseResourceMap(byte[] data, int offset, int size) throws TemplateException {
    if ((size - 8) % 4 != 0) throw failure("AXML resource map is invalid", null);
    ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
    int[] map = new int[(size - 8) / 4];
    for (int i = 0; i < map.length; i++) map[i] = b.getInt(offset + 8 + i * 4);
    return map;
  }

  private static byte[] rebuild(Parsed parsed) throws TemplateException {
    try {
      byte[] pool = rebuildPool(parsed.pool);
      byte[] map = rebuildResourceMap(parsed.resourceMap);
      int chunksSize = parsed.chunks.stream().mapToInt(c -> c.data.length).sum();
      int total = parsed.headerSize + pool.length + map.length + chunksSize;
      ByteBuffer out = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN);
      out.putShort((short) CHUNK_XML).putShort((short) parsed.headerSize).putInt(total);
      while (out.position() < parsed.headerSize) out.put((byte) 0);
      out.put(pool).put(map);
      for (Chunk chunk : parsed.chunks) out.put(chunk.data);
      return out.array();
    } catch (RuntimeException e) {
      throw failure("Could not rebuild binary AndroidManifest.xml", e);
    }
  }

  private static byte[] rebuildPool(StringPool pool) {
    ByteArrayOutputStream stringsOut = new ByteArrayOutputStream();
    int[] offsets = new int[pool.strings.size()];
    for (int i = 0; i < pool.strings.size(); i++) {
      offsets[i] = stringsOut.size();
      if (pool.utf8) writeUtf8(stringsOut, pool.strings.get(i)); else writeUtf16(stringsOut, pool.strings.get(i));
    }
    while ((stringsOut.size() & 3) != 0) stringsOut.write(0);
    byte[] stringBytes = stringsOut.toByteArray();
    int header = 28;
    int stringsStart = header + (offsets.length + pool.styleOffsets.length) * 4;
    int stylesStart = pool.styleOffsets.length > 0 && pool.styleData != null ? stringsStart + stringBytes.length : 0;
    int styleSize = pool.styleData == null ? 0 : pool.styleData.length;
    int size = stringsStart + stringBytes.length + styleSize;
    int delta = stringBytes.length - pool.originalStringsSize;
    ByteBuffer b = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short) CHUNK_STRING_POOL).putShort((short) header).putInt(size)
        .putInt(offsets.length).putInt(pool.styleOffsets.length).putInt(pool.flags).putInt(stringsStart).putInt(stylesStart);
    for (int off : offsets) b.putInt(off);
    for (int off : pool.styleOffsets) b.putInt(off + delta);
    b.put(stringBytes);
    if (pool.styleData != null) b.put(pool.styleData);
    return b.array();
  }

  private static byte[] rebuildResourceMap(int[] map) {
    if (map == null) return new byte[0];
    ByteBuffer b = ByteBuffer.allocate(8 + map.length * 4).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short) CHUNK_RESOURCE_MAP).putShort((short) 8).putInt(b.capacity());
    for (int id : map) b.putInt(id);
    return b.array();
  }

  private static AttrTable attributes(Chunk chunk) throws TemplateException {
    if (chunk.data.length < 36) throw failure("AXML start element is truncated", null);
    int attrStart = getShort(chunk.data, 24);
    int attrSize = getShort(chunk.data, 26);
    int count = getShort(chunk.data, 28);
    if (attrStart < 20 || attrSize < 20 || count < 0) throw failure("AXML attribute table is invalid", null);
    int first = 16 + attrStart;
    if ((long) first + (long) attrSize * count > chunk.data.length) throw failure("AXML attributes are truncated", null);
    return new AttrTable(first, attrSize, count);
  }

  private static String elementName(Parsed parsed, Chunk chunk) throws TemplateException {
    if (chunk.data.length < 24) throw failure("AXML element is truncated", null);
    return stringAt(parsed, getInt(chunk.data, 20));
  }

  private static int resourceIndex(Parsed parsed, int resourceId) {
    if (parsed.resourceMap == null) return -1;
    for (int i = 0; i < parsed.resourceMap.length; i++) if (parsed.resourceMap[i] == resourceId) return i;
    return -1;
  }

  private static String stringAt(Parsed parsed, int index) throws TemplateException {
    if (index < 0 || index >= parsed.pool.strings.size()) throw failure("AXML string index is invalid", null);
    return parsed.pool.strings.get(index);
  }

  private static int addString(StringPool pool, String value) {
    int existing = pool.strings.indexOf(value);
    if (existing >= 0) return existing;
    pool.strings.add(value);
    return pool.strings.size() - 1;
  }

  private static String readUtf8(byte[] data, int offset, int end) throws TemplateException {
    int[] charLen = readLength8(data, offset, end);
    int p = offset + charLen[1];
    int[] byteLen = readLength8(data, p, end);
    p += byteLen[1];
    if (byteLen[0] < 0 || p + byteLen[0] >= end) throw failure("AXML UTF-8 string is truncated", null);
    return new String(data, p, byteLen[0], StandardCharsets.UTF_8);
  }

  private static int[] readLength8(byte[] data, int offset, int end) throws TemplateException {
    if (offset >= end) throw failure("AXML string length is truncated", null);
    int first = data[offset] & 0xff;
    if ((first & 0x80) == 0) return new int[] {first, 1};
    if (offset + 1 >= end) throw failure("AXML long string length is truncated", null);
    return new int[] {((first & 0x7f) << 8) | (data[offset + 1] & 0xff), 2};
  }

  private static String readUtf16(byte[] data, int offset, int end) throws TemplateException {
    if (offset + 2 > end) throw failure("AXML UTF-16 string is truncated", null);
    ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
    int first = b.getShort(offset) & 0xffff;
    int length;
    int p = offset + 2;
    if ((first & 0x8000) != 0) {
      if (p + 2 > end) throw failure("AXML UTF-16 length is truncated", null);
      length = ((first & 0x7fff) << 16) | (b.getShort(p) & 0xffff);
      p += 2;
    } else length = first;
    long bytes = (long) length * 2L;
    if (bytes > Integer.MAX_VALUE || p + bytes + 2L > end) throw failure("AXML UTF-16 data is truncated", null);
    return new String(data, p, (int) bytes, StandardCharsets.UTF_16LE);
  }

  private static void writeUtf8(ByteArrayOutputStream out, String value) {
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    writeLength8(out, value.length());
    writeLength8(out, bytes.length);
    out.writeBytes(bytes);
    out.write(0);
  }

  private static void writeLength8(ByteArrayOutputStream out, int length) {
    if (length > 0x7fff) throw new IllegalArgumentException("AXML string too long");
    if (length > 0x7f) { out.write(0x80 | ((length >> 8) & 0x7f)); out.write(length & 0xff); }
    else out.write(length);
  }

  private static void writeUtf16(ByteArrayOutputStream out, String value) {
    int length = value.length();
    if (length > 0x7fffffff) throw new IllegalArgumentException("AXML string too long");
    if (length > 0x7fff) {
      int high = 0x8000 | ((length >>> 16) & 0x7fff);
      out.write(high & 0xff); out.write((high >>> 8) & 0xff);
      out.write(length & 0xff); out.write((length >>> 8) & 0xff);
    } else {
      out.write(length & 0xff); out.write((length >>> 8) & 0xff);
    }
    out.writeBytes(value.getBytes(StandardCharsets.UTF_16LE));
    out.write(0); out.write(0);
  }

  private static int getInt(byte[] data, int offset) { return ByteBuffer.wrap(data, offset, 4).order(ByteOrder.LITTLE_ENDIAN).getInt(); }
  private static void putInt(byte[] data, int offset, int value) { ByteBuffer.wrap(data, offset, 4).order(ByteOrder.LITTLE_ENDIAN).putInt(value); }
  private static int getShort(byte[] data, int offset) { return ByteBuffer.wrap(data, offset, 2).order(ByteOrder.LITTLE_ENDIAN).getShort() & 0xffff; }
  private static void putShort(byte[] data, int offset, int value) { ByteBuffer.wrap(data, offset, 2).order(ByteOrder.LITTLE_ENDIAN).putShort((short) value); }

  private static TemplateException failure(String message, Throwable cause) {
    return cause == null
        ? new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, message)
        : new TemplateException(TemplateErrorCode.PATCH_MANIFEST_FAILED, message, cause);
  }

  private record Parsed(int headerSize, StringPool pool, int[] resourceMap, List<Chunk> chunks) {}
  private record StringPool(int flags, boolean utf8, List<String> strings, int[] styleOffsets, byte[] styleData, int originalStringsSize) {}
  private record Chunk(int type, byte[] data) {}
  private record AttrTable(int first, int size, int count) {}
}
