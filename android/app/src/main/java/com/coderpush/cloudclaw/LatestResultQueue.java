package com.coderpush.cloudclaw;

import java.util.HashSet;
import java.util.Set;

/** Bounded messages in transit, plus one replaceable newest result. */
final class LatestResultQueue<T> {
 private int maxInFlight = 2;
 private final Set<Long> inFlight = new HashSet<>();
 private long generation, latestId, lastOfferedId;
 private T latest;
 private boolean scheduled;

 synchronized void reset(long nextGeneration) { reset(nextGeneration, 2); }

 synchronized void reset(long nextGeneration, int window) {
  if (window != 2 && window != 4) throw new IllegalArgumentException("Delivery window must be 2 or 4");
  maxInFlight = window;
  generation = nextGeneration;
  inFlight.clear();
  latest = null;
  scheduled = false;
  lastOfferedId = 0;
 }

 synchronized boolean offer(long gen, long id, T value) {
  if (gen != generation || id <= lastOfferedId) return false;
  lastOfferedId = id;
  latest = value;
  latestId = id;
  return scheduleIfReady();
 }

 synchronized T take(long gen) {
  if (gen != generation) return null;
  scheduled = false;
  if (inFlight.size() >= maxInFlight || latest == null) return null;
  T value = latest;
  latest = null;
  inFlight.add(latestId);
  return value;
 }

 synchronized boolean acknowledge(long gen, long id) {
  if (gen != generation || !inFlight.remove(id)) return false;
  return scheduleIfReady();
 }

 private boolean scheduleIfReady() {
  if (latest == null || inFlight.size() >= maxInFlight || scheduled) return false;
  scheduled = true;
  return true;
 }
}
