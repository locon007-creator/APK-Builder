package com.osulsa.apkbuilder.engine;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;

/** Shared real binary-AXML manifest fixture for engine integration tests. */
final class TestBinaryManifest {
  private TestBinaryManifest() {}

  private static final int CHUNK_XML = 0x0003;
  private static final int CHUNK_STRING_POOL = 0x0001;
  private static final int CHUNK_RESOURCE_MAP = 0x0180;
  private static final int CHUNK_START_ELEMENT = 0x0102;
  private static final int CHUNK_END_ELEMENT = 0x0103;
  private static final int TYPE_STRING = 0x03;
  private static final int TYPE_INT_DEC = 0x10;
  private static final int ATTR_LABEL = 0x01010001;
  private static final int ATTR_VERSION_CODE = 0x0101021b;
  private static final int ATTR_VERSION_NAME = 0x0101021c;

  static byte[] shellManifest(String packageName) throws Exception {
    List<String> strings = List.of(
        "manifest",        // 0
        "package",         // 1
        packageName,       // 2
        "versionCode",     // 3
        "versionName",     // 4
        "0.1.0",           // 5
        "application",     // 6
        "label",           // 7
        "Template App"     // 8
    );

    byte[] pool = utf8StringPool(strings);
    ByteBuffer map = ByteBuffer.allocate(8 + strings.size() * 4).order(ByteOrder.LITTLE_ENDIAN);
    map.putShort((short) CHUNK_RESOURCE_MAP).putShort((short) 8).putInt(map.capacity());
    for (int i = 0; i < strings.size(); i++) {
      int resourceId = switch (i) {
        case 3 -> ATTR_VERSION_CODE;
        case 4 -> ATTR_VERSION_NAME;
        case 7 -> ATTR_LABEL;
        default -> 0;
      };
      map.putInt(resourceId);
    }

    byte[] manifestStart = startElement(0, new Attr[] {
        Attr.string(1, 2),
        Attr.integer(3, 1),
        Attr.string(4, 5)
    });
    byte[] applicationStart = startElement(6, new Attr[] {Attr.string(7, 8)});
    byte[] applicationEnd = endElement(6);
    byte[] manifestEnd = endElement(0);

    int total = 8 + pool.length + map.capacity()
        + manifestStart.length + applicationStart.length + applicationEnd.length + manifestEnd.length;
    ByteBuffer xml = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN);
    xml.putShort((short) CHUNK_XML).putShort((short) 8).putInt(total);
    xml.put(pool).put(map.array()).put(manifestStart).put(applicationStart).put(applicationEnd).put(manifestEnd);
    return xml.array();
  }

  private static byte[] startElement(int nameIndex, Attr[] attrs) {
    int size = 36 + attrs.length * 20;
    ByteBuffer b = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short) CHUNK_START_ELEMENT).putShort((short) 16).putInt(size);
    b.putInt(1).putInt(-1).putInt(-1).putInt(nameIndex);
    b.putShort((short) 20).putShort((short) 20).putShort((short) attrs.length)
        .putShort((short) 0).putShort((short) 0).putShort((short) 0);
    for (Attr attr : attrs) {
      b.putInt(-1).putInt(attr.nameIndex).putInt(attr.type == TYPE_STRING ? attr.value : -1)
          .putShort((short) 8).put((byte) 0).put((byte) attr.type).putInt(attr.value);
    }
    return b.array();
  }

  private static byte[] endElement(int nameIndex) {
    ByteBuffer b = ByteBuffer.allocate(24).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short) CHUNK_END_ELEMENT).putShort((short) 16).putInt(24);
    b.putInt(1).putInt(-1).putInt(-1).putInt(nameIndex);
    return b.array();
  }

  private static byte[] utf8StringPool(List<String> strings) throws Exception {
    ByteArrayOutputStream data = new ByteArrayOutputStream();
    int[] offsets = new int[strings.size()];
    for (int i = 0; i < strings.size(); i++) {
      String value = strings.get(i);
      byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
      if (value.length() > 127 || bytes.length > 127) throw new IllegalArgumentException("fixture string too long");
      offsets[i] = data.size();
      data.write(value.length());
      data.write(bytes.length);
      data.write(bytes);
      data.write(0);
    }
    while ((data.size() & 3) != 0) data.write(0);

    int header = 28;
    int stringsStart = header + offsets.length * 4;
    int size = stringsStart + data.size();
    ByteBuffer b = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
    b.putShort((short) CHUNK_STRING_POOL).putShort((short) header).putInt(size);
    b.putInt(strings.size()).putInt(0).putInt(0x100).putInt(stringsStart).putInt(0);
    for (int offset : offsets) b.putInt(offset);
    b.put(data.toByteArray());
    return b.array();
  }

  private record Attr(int nameIndex, int type, int value) {
    static Attr string(int nameIndex, int stringIndex) { return new Attr(nameIndex, TYPE_STRING, stringIndex); }
    static Attr integer(int nameIndex, int value) { return new Attr(nameIndex, TYPE_INT_DEC, value); }
  }
}
