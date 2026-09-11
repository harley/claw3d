// Hosted Linux runners have no GPU. Opt in only for trusted CI pages;
// local browser checks retain their normal hardware-backed rendering.
export const browserOptions = {
  channel: process.env.GITHUB_ACTIONS === 'true' ? undefined : 'chrome', headless: process.env.GITHUB_ACTIONS !== 'true',
  args: process.env.GITHUB_ACTIONS === 'true'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
};
