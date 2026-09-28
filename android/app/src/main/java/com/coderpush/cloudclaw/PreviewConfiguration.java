package com.coderpush.cloudclaw;

// Main-thread preferences only. A toggle never rebinds or stops camera input.
final class PreviewConfiguration {
 private boolean requested, applied;
 PreviewConfiguration(){this(false,false);}
 PreviewConfiguration(boolean requested,boolean applied){this.requested=requested;this.applied=applied;}
 void toggleRequested(){requested=!requested;}
 boolean requested(){return requested;}
 boolean applied(){return applied;}
 boolean pending(){return requested!=applied;}
 // The game owns the between-runs decision. Capture once, before async startup.
 boolean beginSession(boolean betweenRuns){
  if(betweenRuns)applied=requested;
  return applied;
 }
}
