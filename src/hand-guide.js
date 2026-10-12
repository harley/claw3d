import './hand-guide.css';

// The dialog and static in-play reference share artwork and instructions.
// No camera, second scene, animation loop, or saved game state belongs here.
const artwork = new URL('./assets/hand-guide.png', import.meta.url).href;
const overheadClaw = new URL('./assets/hand-guide-overhead.png', import.meta.url).href;
const steps = [
  { title: 'MOVE <em>UP</em> & <mark>DOWN</mark>', caption: 'Hand <em>HIGHER</em> → FARTHER<br>Hand <mark>LOWER</mark> → CLOSER', hint: 'The claw slides over the toys. It stays raised.', first: 'HAND UP', second: 'HAND DOWN', axis: 'depth' },
  { title: 'MOVE <em>LEFT</em> & <mark>RIGHT</mark>', caption: '<em>LEFT</em> = LEFT &nbsp; <mark>RIGHT</mark> = RIGHT', hint: 'Move your open hand sideways.', first: 'HAND LEFT', second: 'HAND RIGHT', axis: 'sideways' },
  { title: 'CLENCH & <em>HOLD</em>', caption: 'HOLD YOUR FIST TO <em>DROP</em>', hint: 'Keep your fist closed until the claw drops. Open early to cancel.', first: 'OPEN TO AIM', second: 'HOLD TO DROP', axis: 'drop' },
];

export function createHandGuideReference() {
  const reference = document.createElement('aside');
  reference.id = 'hand-guide-reference';
  reference.hidden = true;
  reference.setAttribute('aria-labelledby', 'hand-reference-title');
  reference.innerHTML = `<h2 id="hand-reference-title">HOW TO PLAY</h2><ol>${steps.map((content, index) => `
    <li><div class="reference-art" aria-hidden="true" style="--guide-art: url('${artwork}')"><i class="guide-sprite ${index === 2 ? 'fist' : 'palm'}"></i><span>${['↕', '↔', ''][index]}</span></div>
    <div><h3>${content.title}</h3><p>${content.caption}</p>${index === 2 ? '<small>Keep closed until the claw drops.</small>' : ''}</div></li>`).join('')}</ol>`;
  document.getElementById('arcade').append(reference);
  return reference;
}

const dualSteps = [
  { title: 'SHOW <em>LEFT HAND</em>', caption: 'OPEN LEFT HAND TO <em>START</em>', hint: 'Hold your open left hand still until it is found.', axis: 'acquire' },
  { title: 'FIST TO <em>AIM</em>', caption: 'LEFT FIST <em>MOVES THE CLAW</em>', hint: 'Close your left hand, then move it to aim. Keep the fist closed.', axis: 'grip' },
  { title: 'PALM TO <em>DROP</em>', caption: 'RIGHT PALM <em>DROPS THE CLAW</em>', hint: 'Keep your left fist closed. Move your right palm into DROP; if it is already there, move off and back.', axis: 'palm' },
];
export function createHandGuide({ phone = false, dual = false, canOpen, onTransition = () => {} }) {
  const tutorialSteps = dual ? dualSteps : steps;
  const dialog = document.createElement('dialog');
  dialog.id = 'hand-guide';
  dialog.setAttribute('aria-labelledby', 'hand-guide-title');
  dialog.setAttribute('aria-describedby', 'hand-guide-hint');
  document.getElementById('arcade').append(dialog);
  let step = 0, previousDialog = null, opener = null;
  function render() {
    const content = tutorialSteps[step];
    dialog.dataset.step = content.axis;
    dialog.innerHTML = `
      <button id="hand-guide-close" class="guide-close" aria-label="Close how to play">×</button>
      <div class="guide-count" aria-live="polite">${step + 1} / 3</div>
      <h1 id="hand-guide-title">${content.title}</h1>
      ${phone ? '<p class="phone-guide-setup">Prop up your phone and face the camera. Keep one open hand in view.</p>' : ''}
      ${dual ? `<div class="dual-tutorial" aria-hidden="true" style="--guide-art: url('${artwork}')"><div class="dual-tutorial-hand left"><i class="guide-sprite ${step === 0 ? 'palm' : 'fist'}"></i><strong>Left · ${step === 0 ? 'open' : 'fist'}</strong></div><div class="dual-tutorial-hand ${step < 2 ? 'waiting' : ''}"><i class="guide-sprite palm"></i><strong>Right · palm</strong></div></div>` : `<div class="guide-demo" aria-hidden="true" style="--guide-art: url('${artwork}'); --guide-overhead: url('${overheadClaw}')">
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
      </div>`}
      <h2 class="guide-caption">${content.caption}</h2>
      <p id="hand-guide-hint">${content.hint}</p>
      <footer class="guide-footer"><nav aria-label="Tutorial steps">${(dual ? ['OPEN LEFT', 'LEFT FIST', 'RIGHT PALM'] : ['UP / DOWN', 'LEFT / RIGHT', 'HOLD FIST']).map((label, index) => `<button id="hand-guide-step-${index}" ${index === step ? 'aria-current="step"' : ''}><b>${index + 1}</b><span>${label}</span></button>`).join('')}</nav><button id="hand-guide-next">${step === 2 ? 'GOT IT' : 'NEXT'} <span aria-hidden="true">›</span></button></footer>`;
    dialog.querySelector('#hand-guide-close').onclick = () => dialog.close();
    dialog.querySelector('#hand-guide-next').onclick = () => step === 2 ? dialog.close() : select(step + 1);
    tutorialSteps.forEach((_, index) => { dialog.querySelector(`#hand-guide-step-${index}`).onclick = () => select(index); });
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
    if (previousDialog && !['final', 'mobile-menu'].includes(previousDialog.id)) return;
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
  if (phone) document.getElementById('mobile-help').addEventListener('click', open);
  document.addEventListener('visibilitychange', () => { dialog.classList.toggle('guide-suspended', document.hidden); });
  return dialog;
}
