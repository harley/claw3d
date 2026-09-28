package com.coderpush.cloudclaw;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class ScoreExportTest {
 @Test public void writesLargeSnapshotExactlyAndClosesBeforeSuccess() throws Exception {
  String data="{\"name\":\"Tiếng Việt\",\"scores\":\""+"x".repeat(10000)+"\"}";
  boolean[] closed={false};
  ByteArrayOutputStream out=new ByteArrayOutputStream(){@Override public void close(){closed[0]=true;}};
  ScoreExport.write(out,data);
  assertTrue(closed[0]);assertEquals(data,out.toString(StandardCharsets.UTF_8));
 }
 @Test public void closeFailureCannotReportSaved() {
  OutputStream out=new ByteArrayOutputStream(){@Override public void close() throws IOException {throw new IOException("Disk full");}};
  assertThrows(IOException.class,()->ScoreExport.write(out,"{}"));
 }
 @Test public void failedWriteStillClosesAndPropagates() {
  boolean[] closed={false};
  OutputStream out=new OutputStream(){public void write(int b) throws IOException {throw new IOException("Write failed");}public void close(){closed[0]=true;}};
  assertThrows(IOException.class,()->ScoreExport.write(out,"{}"));assertTrue(closed[0]);
  assertThrows(IOException.class,()->ScoreExport.write(null,"{}"));
 }
}
