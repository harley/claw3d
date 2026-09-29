package com.coderpush.cloudclaw;

// Keep camera-rate trials stable through an active or recovering run.
final class CameraRateConfiguration {
 static int select(int current,String requested,boolean betweenRuns){
  if(!betweenRuns)return current;
  return "15".equals(requested)?15:0;
 }
}
