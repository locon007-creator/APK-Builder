package com.osulsa.apkbuilder.engine;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class Der {
  private Der() {}
  static byte[] sequence(byte[]... parts) { return tagged(0x30, concat(parts)); }
  static byte[] set(byte[]... parts) { return tagged(0x31, concat(parts)); }
  static byte[] integer(BigInteger n) { return tagged(0x02, n.toByteArray()); }
  static byte[] octet(byte[] data) { return tagged(0x04, data); }
  static byte[] nullValue() { return new byte[]{0x05,0x00}; }
  static byte[] explicit0(byte[] data) { return tagged(0xA0, data); }
  static byte[] implicit0(byte[] data) { return tagged(0xA0, data); }
  static byte[] oid(String dotted) {
    String[] s = dotted.split("\\.");
    if (s.length < 2) throw new IllegalArgumentException("bad oid");
    int first = Integer.parseInt(s[0]), second = Integer.parseInt(s[1]);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    writeBase128(out, 40L * first + second);
    for (int i=2;i<s.length;i++) writeBase128(out, Long.parseLong(s[i]));
    return tagged(0x06, out.toByteArray());
  }
  static byte[] algorithm(String oid) { return sequence(oid(oid), nullValue()); }
  static byte[] tagged(int tag, byte[] data) {
    ByteArrayOutputStream out = new ByteArrayOutputStream(); out.write(tag); writeLength(out, data.length); out.writeBytes(data); return out.toByteArray();
  }
  static byte[] concat(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream(); for (byte[] p: parts) out.writeBytes(p); return out.toByteArray();
  }
  private static void writeLength(ByteArrayOutputStream out, int len) {
    if (len < 128) { out.write(len); return; }
    int bytes = 0, x = len; while (x > 0) { bytes++; x >>>= 8; } out.write(0x80 | bytes); for (int i=bytes-1;i>=0;i--) out.write((len >>> (8*i)) & 0xff);
  }
  private static void writeBase128(ByteArrayOutputStream out, long value) {
    byte[] tmp = new byte[10]; int n=0; tmp[n++] = (byte)(value & 0x7f); value >>>= 7; while (value > 0) { tmp[n++] = (byte)(0x80 | (value & 0x7f)); value >>>= 7; } for (int i=n-1;i>=0;i--) out.write(tmp[i]);
  }
}
