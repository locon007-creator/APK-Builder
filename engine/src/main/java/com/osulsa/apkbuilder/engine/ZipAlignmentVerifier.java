package com.osulsa.apkbuilder.engine;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

public final class ZipAlignmentVerifier {
  private ZipAlignmentVerifier() {}
  public static void verify(Path apk) throws TemplateException {
    try (RandomAccessFile f = new RandomAccessFile(apk.toFile(), "r")) {
      long eocd = findEocd(f);
      f.seek(eocd + 12); long centralSize = u32(f); long centralOffset = u32(f);
      long pos = centralOffset, end = centralOffset + centralSize;
      while (pos < end) {
        f.seek(pos); if (u32(f) != 0x02014b50L) throw new IOException("Bad central directory signature");
        f.skipBytes(6); int method = u16(f); f.skipBytes(16);
        int nameLen = u16(f), extraLen = u16(f), commentLen = u16(f); f.skipBytes(8); long localOffset = u32(f);
        byte[] nameBytes = new byte[nameLen]; f.readFully(nameBytes); String name = new String(nameBytes, StandardCharsets.UTF_8);
        if (method == 0 && !name.endsWith("/")) {
          f.seek(localOffset); if (u32(f) != 0x04034b50L) throw new IOException("Bad local header signature");
          f.skipBytes(22); int localName = u16(f), localExtra = u16(f);
          long dataOffset = localOffset + 30L + localName + localExtra;
          int alignment = name.endsWith(".so") ? 16384 : 4;
          if (dataOffset % alignment != 0) throw new TemplateException(TemplateErrorCode.ALIGN_FAILED, name + " data offset " + dataOffset + " is not aligned to " + alignment);
        }
        pos += 46L + nameLen + extraLen + commentLen;
      }
    } catch (TemplateException e) { throw e; }
    catch (Exception e) { throw new TemplateException(TemplateErrorCode.ALIGN_FAILED, "Could not verify APK ZIP alignment", e); }
  }
  private static long findEocd(RandomAccessFile f) throws IOException {
    long min = Math.max(0, f.length() - 65557); for (long p=f.length()-22;p>=min;p--) { f.seek(p); if (u32(f)==0x06054b50L) return p; } throw new IOException("EOCD not found");
  }
  private static int u16(RandomAccessFile f) throws IOException { int a=f.readUnsignedByte(), b=f.readUnsignedByte(); return a | (b<<8); }
  private static long u32(RandomAccessFile f) throws IOException { long a=u16(f), b=u16(f); return a | (b<<16); }
}
