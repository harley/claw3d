package com.coderpush.cloudclaw;
import org.junit.Test;
import static org.junit.Assert.*;

public class LatestResultQueueTest {
 @Test public void defaultWindowRemainsTwoAndResetClearsTrialCapacity() {
  var queue = new LatestResultQueue<String>(); queue.reset(1,4); queue.reset(2);
  for(long id=1;id<=2;id++){assertTrue(queue.offer(2,id,"frame"));assertEquals("frame",queue.take(2));}
  assertFalse(queue.offer(2,3,"newest")); assertNull(queue.take(2));
 }
 @Test(expected=IllegalArgumentException.class) public void unboundedWindowIsRejected() {
  new LatestResultQueue<String>().reset(1,1000);
 }

 @Test public void fourFramesCanFlowBeforeSlowAcknowledgementsReturn() {
  var queue = new LatestResultQueue<String>();
  // Camera start resets on stop, then configures the window at the same epoch.
  queue.reset(1); queue.reset(1,4);
  assertTrue(queue.offer(1,1,"first")); assertEquals("first",queue.take(1));
  assertTrue(queue.offer(1,2,"second")); assertEquals("second",queue.take(1));
  assertTrue(queue.offer(1,3,"third")); assertEquals("third",queue.take(1));
  assertTrue(queue.offer(1,4,"fourth")); assertEquals("fourth",queue.take(1));
  assertFalse(queue.offer(1,5,"fifth")); assertNull(queue.take(1));
 }
 @Test public void stalledConsumerKeepsOnlyNewestUnsentFrame() {
  var queue = new LatestResultQueue<Long>(); queue.reset(1,4);
  for(long id=1;id<=4;id++){queue.offer(1,id,id);queue.take(1);}
  for(long id=5;id<=10000;id++) assertFalse(queue.offer(1,id,id));
  assertTrue(queue.acknowledge(1,1)); assertEquals(Long.valueOf(10000),queue.take(1));
  assertNull(queue.take(1));
 }
 @Test public void restartDiscardsFramesCallbacksAndOldAcknowledgements() {
  var queue = new LatestResultQueue<String>(); queue.reset(1,4); queue.offer(1,1,"old"); queue.take(1);
  queue.reset(2); assertNull(queue.take(1)); assertFalse(queue.offer(1,2,"late"));
  assertFalse(queue.acknowledge(1,1)); assertTrue(queue.offer(2,3,"new"));
  assertEquals("new",queue.take(2));
 }
 @Test public void duplicateOrOutOfOrderAcknowledgementsCannotCreateExtraCapacity() {
  var queue = new LatestResultQueue<String>(); queue.reset(1,4);
  queue.offer(1,1,"one"); queue.take(1); queue.offer(1,2,"two"); queue.take(1);
  queue.offer(1,3,"three"); queue.take(1); queue.offer(1,4,"four"); queue.take(1);
  queue.offer(1,5,"five"); assertTrue(queue.acknowledge(1,2));
  assertFalse(queue.acknowledge(1,2)); assertFalse(queue.acknowledge(1,999));
  assertEquals("five",queue.take(1)); assertFalse(queue.offer(1,6,"six"));
  assertTrue(queue.acknowledge(1,1)); assertEquals("six",queue.take(1));
 }
 @Test public void callbacksAreCoalescedAndFramesNeverGoBackwards() {
  var queue = new LatestResultQueue<String>(); queue.reset(1,4);
  assertTrue(queue.offer(1,2,"two")); assertFalse(queue.offer(1,1,"old"));
  assertFalse(queue.offer(1,3,"three")); assertEquals("three",queue.take(1));
  assertFalse(queue.offer(1,3,"duplicate")); assertNull(queue.take(1));
 }
}
