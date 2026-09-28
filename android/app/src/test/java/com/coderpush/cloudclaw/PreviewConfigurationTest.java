package com.coderpush.cloudclaw;

import org.junit.Test;
import static org.junit.Assert.*;

public class PreviewConfigurationTest {
 @Test public void togglesDuringStartupDoNotChangeCapturedBinding() {
  PreviewConfiguration config=new PreviewConfiguration();
  boolean binding=config.beginSession(true);
  config.toggleRequested();
  assertFalse(binding);assertFalse(config.applied());assertTrue(config.pending());
  // Even another start during an active/recovering run keeps that binding.
  assertFalse(config.beginSession(false));assertTrue(config.pending());
  assertTrue(config.beginSession(true));assertFalse(config.pending());
 }
 @Test public void activeRunRestartPreservesPreviewUntilBetweenRuns() {
  PreviewConfiguration config=new PreviewConfiguration();config.toggleRequested();
  assertTrue(config.beginSession(true));
  config.toggleRequested();
  assertTrue(config.applied());assertFalse(config.requested());assertTrue(config.pending());
  assertTrue(config.beginSession(false));
  assertFalse(config.beginSession(true));assertFalse(config.pending());
 }
 @Test public void recreationPreservesAppliedAndPendingSettingsSeparately() {
  PreviewConfiguration before=new PreviewConfiguration();before.toggleRequested();before.beginSession(true);before.toggleRequested();
  PreviewConfiguration restored=new PreviewConfiguration(before.requested(),before.applied());
  assertTrue(restored.beginSession(false));assertTrue(restored.pending());assertFalse(restored.requested());
  assertFalse(restored.beginSession(true));assertFalse(restored.pending());
 }
 @Test public void togglingBackCancelsPendingChangeWithoutAStart() {
  PreviewConfiguration config=new PreviewConfiguration();config.toggleRequested();config.toggleRequested();
  assertFalse(config.pending());assertFalse(config.applied());
 }
}
