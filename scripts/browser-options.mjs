// Headed Chromium uses the hosted Mac's virtual Metal GPU. Its headless shell
// falls back to SwiftShader and runs this scene at about 1 FPS. Keep local
// checks on installed Chrome, with their existing headless behavior.
export const browserOptions = {
  channel: process.env.GITHUB_ACTIONS === 'true' ? undefined : 'chrome',
  headless: process.env.GITHUB_ACTIONS !== 'true',
};
