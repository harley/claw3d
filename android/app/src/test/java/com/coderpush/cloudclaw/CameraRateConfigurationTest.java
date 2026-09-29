package com.coderpush.cloudclaw;
import org.junit.Test;
import static org.junit.Assert.*;

public class CameraRateConfigurationTest {
 @Test public void rateTrialIsExplicitAndOnlyChangesBetweenRuns(){
  assertEquals(15,CameraRateConfiguration.select(0,"15",true));
  assertEquals(0,CameraRateConfiguration.select(0,"15",false));
  assertEquals(15,CameraRateConfiguration.select(15,"",false));
  assertEquals(0,CameraRateConfiguration.select(15,"",true));
  assertEquals(0,CameraRateConfiguration.select(0,"120",true));
 }
}
