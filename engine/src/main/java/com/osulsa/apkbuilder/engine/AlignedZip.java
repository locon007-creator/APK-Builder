package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;

final class AlignedZip {
  private AlignedZip() {}
  static final long ZIP_TIME = 315532800000L; // 1980-01-01: avoids extended timestamp extras.

  static final class CountingOutputStream extends FilterOutputStream {
    private long count;
    CountingOutputStream(OutputStream out) { super(out); }
    long count() { return count; }
    @Override public void write(int b) throws IOException { out.write(b); count++; }
    @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); count += len; }
  }

  static ZipEntry copyMetadata(ZipEntry source, long bytesBeforeHeader) {
    ZipEntry out = new ZipEntry(source.getName());
    out.setTime(ZIP_TIME);
    if (source.isDirectory()) return out;
    if (source.getMethod() == ZipEntry.STORED) {
      out.setMethod(ZipEntry.STORED);
      out.setSize(source.getSize()); out.setCompressedSize(source.getSize()); out.setCrc(source.getCrc());
      int alignment = source.getName().endsWith(".so") ? 16384 : 4;
      out.setExtra(paddingExtra(bytesBeforeHeader, source.getName(), alignment));
    } else {
      out.setMethod(ZipEntry.DEFLATED);
    }
    return out;
  }

  static byte[] paddingExtra(long bytesBeforeHeader, String name, int alignment) {
    int base = (int)((bytesBeforeHeader + 30L + name.getBytes(StandardCharsets.UTF_8).length) % alignment);
    int needed = (alignment - base) % alignment;
    if (needed == 0) return null;
    int total = needed >= 4 ? needed : needed + alignment;
    byte[] extra = new byte[total];
    extra[0] = (byte)0xD9; extra[1] = (byte)0xA1; // private padding field id 0xA1D9
    int dataLen = total - 4;
    extra[2] = (byte)(dataLen & 0xff); extra[3] = (byte)((dataLen >>> 8) & 0xff);
    return extra;
  }
}
