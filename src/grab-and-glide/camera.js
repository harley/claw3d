import { HandController } from '../vision.js';

// Reuse the production capture driver, model, freshness/generation checks, owner
// matching and preview. Recognition-only phase bypasses all legacy game actions.
export class GlideCamera extends HandController {
  constructor({ video, overlay, select, onEvidence, onStatus }) {
    let capturedAt = null;
    super({ video, overlay, select, maxHands: 1, getPhase: () => 'recognizing',
      onInput: () => {}, onStart: () => {}, onDrop: () => false,
      onState: state => {
        onStatus(state);
        onEvidence({ at: capturedAt, point: state.pointer, open: state.open === true, closed: state.closed === true,
          valid: !!state.pointer && state.handCount === 1 && ['tracking', 'clenching'].includes(state.kind) });
      },
    });
    this.stamp = at => { capturedAt = at; };
    this.onEvidence = onEvidence;
  }
  handle(result, at) { this.stamp(at); super.handle(result, at); }
  acceptResult(...args) {
    const accepted = super.acceptResult(...args);
    if (!accepted) this.onEvidence({ valid: false });
    return accepted;
  }
}
