// Pin CI browsers to Playwright; local checks continue using installed Chrome.
export const browserOptions = {
  channel: process.env.GITHUB_ACTIONS === 'true' ? undefined : 'chrome', headless: true,

};

// Routine captures can outlast short game phases on software rendering.
// Keep them for local visual review; CI still runs every behavior assertion
// and captures failures after the assertion has already failed.
export const captureArtifacts = process.env.GITHUB_ACTIONS !== 'true';
export async function captureScreenshot(page, options) {
  if (captureArtifacts) await page.screenshot(options);
}

export const browserContextOptions = { deviceScaleFactor: 1 };
