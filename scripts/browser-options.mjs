// Hosted Linux runners have no GPU. Opt in only for trusted CI pages;
// local browser checks retain their normal hardware-backed rendering.
export const browserOptions = {
  channel: process.env.GITHUB_ACTIONS === 'true' ? undefined : 'chrome', headless: process.env.GITHUB_ACTIONS !== 'true',
  args: process.env.GITHUB_ACTIONS === 'true'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
};

// Routine captures can outlast short game phases on software rendering.
// Keep them for local visual review; CI still runs every behavior assertion
// and captures failures after the assertion has already failed.
export const captureArtifacts = process.env.GITHUB_ACTIONS !== 'true';
export async function captureScreenshot(page, options) {
  if (captureArtifacts) await page.screenshot(options);
}

// Exercise the same CSS viewport and scene at fewer render pixels on CPU-only
// runners. GPU speed and full-resolution visual acceptance stay local.
export const browserContextOptions = { deviceScaleFactor: process.env.GITHUB_ACTIONS === 'true' ? 0.25 : 1 };
