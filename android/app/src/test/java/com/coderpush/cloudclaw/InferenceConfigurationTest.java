package com.coderpush.cloudclaw;

import org.junit.Test;
import static org.junit.Assert.*;

public class InferenceConfigurationTest {
 // Contract: changing URL must not change the backend during active/recovered play.
 @Test public void activeOrRecoveringRunRetainsItsBackend(){
  assertEquals("GPU",InferenceConfiguration.select("GPU","CPU",false));
  assertEquals("CPU",InferenceConfiguration.select("CPU","GPU",false));
 }
 @Test public void explicitBetweenRunChoiceCanSwitchAndSwitchBack(){
  assertEquals("CPU",InferenceConfiguration.select("GPU","CPU",true));
  assertEquals("GPU",InferenceConfiguration.select("CPU","GPU",true));
 }
 @Test public void absentAndInvalidOptionsPreserveTheSavedBackend(){
  assertEquals("CPU",InferenceConfiguration.select("CPU","",true));
  assertEquals("GPU",InferenceConfiguration.select("GPU","invalid",true));
  assertEquals("GPU",InferenceConfiguration.select(null,null,true));
 }
}
