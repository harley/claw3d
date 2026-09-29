package com.coderpush.cloudclaw;

// A backend comparison is a between-runs camera-start choice, never a live switch.
final class InferenceConfiguration {
 static String select(String saved,String requested,boolean betweenRuns){
  String current="CPU".equals(saved)?"CPU":"GPU";
  if(!betweenRuns)return current;
  return "CPU".equals(requested)||"GPU".equals(requested)?requested:current;
 }
}
