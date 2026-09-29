import './hand-guide.css';

// Illustrations are decoded only when a visitor opens the guide. No camera,
// second scene, animation loop, or saved game state belongs to this component.
const artwork = new URL('./assets/hand-guide.png', import.meta.url).href;
const overheadClaw = new URL('./assets/hand-guide-overhead.png', import.meta.url).href;
const steps = [
  { title: 'MOVE <em>UP</em> & <mark>DOWN</mark>', caption: 'Hand <em>HIGHER</em> → FARTHER<br>Hand <mark>LOWER</mark> → CLOSER', hint: 'The claw slides over the toys. It stays raised.', first: 'HAND UP', second: 'HAND DOWN', axis: 'depth' },
  { title: 'MOVE <em>LEFT</em> & <mark>RIGHT</mark>', caption: '<em>LEFT</em> = LEFT &nbsp; <mark>RIGHT</mark> = RIGHT', hint: 'Move your open hand sideways.', first: 'HAND LEFT', second: 'HAND RIGHT', axis: 'sideways' },
  { title: 'CLENCH & <em>HOLD</em>', caption: 'HOLD YOUR FIST TO <em>DROP</em>', hint: 'Keep your fist closed until the claw drops. Open early to cancel.', first: 'OPEN TO AIM', second: 'HOLD TO DROP', axis: 'drop' },
];

export function createHandGuide({ canOpen, onTransition = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'hand-guide';
  dialog.setAttribute('aria-labelledby', 'hand-guide-title');
  dialog.setAttribute('aria-describedby', 'hand-guide-hint');
  document.getElementById('arcade').append(dialog);
  let step = 0, previousDialog = null, opener = null;
  function render() {
    const content = steps[step];
    dialog.dataset.step = content.axis;
    dialog.innerHTML = `
      <button id="hand-guide-close" class="guide-close" aria-label="Close how to play">×</button>
      <div class="guide-count" aria-live="polite">${step + 1} / 3</div>
      <h1 id="hand-guide-title">${content.title}</h1>
      <div class="guide-demo" aria-hidden="true" style="--guide-art: url('${artwork}'); --guide-overhead: url('${overheadClaw}')">
        <div class="guide-hand-panel">
          <div class="guide-hand ghost"><i class="guide-sprite palm"></i></div>
          <div class="guide-hand moving"><i class="guide-sprite palm"></i><i class="guide-sprite fist"></i></div>
          <div class="guide-direction first">${step === 0 ? '↑' : step === 1 ? '←' : ''}<span>${content.first}</span></div>
          <div class="guide-direction second">${step === 0 ? '↓' : step === 1 ? '→' : ''}<span>${content.second}</span></div>
        </div>
        <div class="guide-bed-panel"><span class="guide-bed-label">${step === 2 ? 'DROP · SIDE VIEW' : 'TOP VIEW · BACK'}</span><div class="guide-bed">
          <i class="guide-sprite bed"></i>
          <div class="guide-claw ghost"><i class="guide-sprite claw"></i></div>
          <div class="guide-claw moving"><i class="guide-sprite claw"></i></div>
          <span class="guide-bed-track"></span>
        </div><span class="guide-bed-label">${step === 2 ? 'CLAW LOWERS' : 'FRONT · YOU'}</span></div>
      </div>
      <h2 class="guide-caption">${content.caption}</h2>
      <p id="hand-guide-hint">${content.hint}</p>
      <footer class="guide-footer"><nav aria-label="Tutorial steps">${['UP / DOWN', 'LEFT / RIGHT', 'HOLD FIST'].map((label, index) => `<button id="hand-guide-step-${index}" ${index === step ? 'aria-current="step"' : ''}><b>${index + 1}</b><span>${label}</span></button>`).join('')}</nav><button id="hand-guide-next">${step === 2 ? 'GOT IT' : 'NEXT'} <span aria-hidden="true">›</span></button></footer>`;
    dialog.querySelector('#hand-guide-close').onclick = () => dialog.close();
    dialog.querySelector('#hand-guide-next').onclick = () => step === 2 ? dialog.close() : select(step + 1);
    steps.forEach((_, index) => { dialog.querySelector(`#hand-guide-step-${index}`).onclick = () => select(index); });
  }
  function select(index) {
    step = index;
    render();
    onTransition();
    dialog.querySelector('#hand-guide-next').focus();
  }
  function open(event) {
    if (dialog.open || !canOpen()) return;
    previousDialog = document.querySelector('dialog[open]');
    if (previousDialog && previousDialog.id !== 'final') return;
    opener = event.currentTarget;
    previousDialog?.close();
    step = 0;
    render();
    dialog.showModal();
    dialog.querySelector('#hand-guide-next').focus();
    onTransition();
  }
  dialog.addEventListener('close', () => {
    // Removing illustrated elements also cancels every CSS animation and frees
    // their compositing layers. Reopening always starts with depth, step one.
    dialog.replaceChildren();
    if (previousDialog?.isConnected) previousDialog.showModal();
    previousDialog = null;
    opener?.focus();
    onTransition();
  });
  document.getElementById('how-to-play').addEventListener('click', open);
  document.getElementById('final-how-to-play').addEventListener('click', open);
  document.addEventListener('visibilitychange', () => { dialog.classList.toggle('guide-suspended', document.hidden); });
  return dialog;
}
