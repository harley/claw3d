// Hosted Linux runners have no GPU. Opt in only for trusted CI pages;
// local browser checks retain their normal hardware-backed rendering.
export const browserOptions = {
  channel: 'chrome', headless: true,
  args: process.env.GITHUB_ACTIONS === 'true'
    ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'] : [],
};
