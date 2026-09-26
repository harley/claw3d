export const browserSuites = Object.freeze([
  'play-modes',
  'dual-hand-controls',
  'grab-release',
  'hand-menu',
  'arcade-presentation',
  'target-label',
  'audio',
  'movement-music',
  'camera',
  'gesture-feedback',
  'arcade',
  'carousel',
  'contact',
  'delivery-clearance',
]);

// Balance the same four runners using post-cleanup suite timings (issue #120).
// Each runner stays sequential; the default local order above is unchanged.
export const browserShards = Object.freeze({
  'shard-1': Object.freeze(['play-modes', 'dual-hand-controls', 'audio']),
  'shard-2': Object.freeze(['grab-release', 'camera', 'gesture-feedback', 'target-label']),
  'shard-3': Object.freeze(['arcade-presentation', 'arcade']),
  'shard-4': Object.freeze(['movement-music', 'carousel', 'contact', 'delivery-clearance', 'hand-menu']),
});

export function selectBrowserSuites(args = []) {
  if (args.length === 0) return [...browserSuites];
  if (!['--only', '--shard'].includes(args[0]) || args.length > 2) {
    throw new Error('Usage: node scripts/check-browser.mjs [--only suite-a,suite-b | --shard shard-name]');
  }

  const [option, value] = args;
  if (args.length !== 2 || !value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }

  const selected = option === '--shard'
    ? browserShards[value]
    : value.split(',').map(suite => suite.trim());
  if (!selected) {
    throw new Error(`Unknown browser shard "${value}". Choose one of: ${Object.keys(browserShards).join(', ')}.`);
  }
  if (selected.some(suite => !suite)) {
    throw new Error('--only must be a comma-separated list of suite names.');
  }

  const duplicates = selected.filter((suite, index) => selected.indexOf(suite) !== index);
  if (duplicates.length) {
    throw new Error(`Duplicate browser suite: ${[...new Set(duplicates)].join(', ')}.`);
  }
  const unknown = selected.filter(suite => !browserSuites.includes(suite));
  if (unknown.length) {
    throw new Error(`Unknown browser suite: ${unknown.join(', ')}. Choose from: ${browserSuites.join(', ')}.`);
  }
  return [...selected];
}
