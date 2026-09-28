package com.coderpush.cloudclaw;

import java.util.HashSet;
import java.util.Set;

/** Two messages in transit, plus one replaceable newest result. */
final class LatestResultQueue<T> {
 private static final int MAX_IN_FLIGHT = 2;
 private final Set<Long> inFlight = new HashSet<>();
 private long generation, latestId, lastOfferedId;
 private T latest;
 private boolean scheduled;

 synchronized void reset(long nextGeneration) {
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
  if (inFlight.size() >= MAX_IN_FLIGHT || latest == null) return null;
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
  if (latest == null || inFlight.size() >= MAX_IN_FLIGHT || scheduled) return false;
  scheduled = true;
  return true;
 }
}
