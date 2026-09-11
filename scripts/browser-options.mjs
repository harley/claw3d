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

const configuredPages = new WeakSet();
export async function configureCIPage(page) {
  if (process.env.GITHUB_ACTIONS !== 'true' || configuredPages.has(page)) return;
  configuredPages.add(page);
  await page.addInitScript(() => {
    // Use the existing operator setting after startup, including on reload.
    // This changes only this browser's transient graphics quality.
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.arcadeReady !== 'true') return;
      document.getElementById('quality')?.click();
      observer.disconnect();
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-arcade-ready'] });
  });
}
