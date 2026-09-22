// One definition of the MediaPipe recognizer for both runtimes (worker and the
// WebKit main-thread fallback). One-hand play asks the model for one hand so a
// bystander's hand cannot displace the player's; dual play needs both.
export const HAND_CONFIDENCE = Object.freeze({ detection: .65, presence: .5, tracking: .5 });

export function recognizerOptions(base, delegate, maxHands = 1) {
  return {
    baseOptions: { modelAssetPath: base + '/vision/gesture_recognizer.task', delegate },
    runningMode: 'VIDEO', numHands: maxHands === 2 ? 2 : 1,
    minHandDetectionConfidence: HAND_CONFIDENCE.detection,
    minHandPresenceConfidence: HAND_CONFIDENCE.presence,
    minTrackingConfidence: HAND_CONFIDENCE.tracking,
  };
}
