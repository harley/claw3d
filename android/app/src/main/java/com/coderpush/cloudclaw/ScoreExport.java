package com.coderpush.cloudclaw;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Closes the picker stream before reporting success; never mutates the score store. */
final class ScoreExport {
 static void write(OutputStream stream,String data) throws IOException {
  if(stream==null)throw new IOException("No output stream");
  try(OutputStream out=stream){out.write(data.getBytes(StandardCharsets.UTF_8));}
 }
}
