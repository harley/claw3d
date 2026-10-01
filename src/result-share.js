export function resultShare(run, origin) {
  if (!run || !Number.isInteger(run.rank) || run.rank < 1 || run.turns?.length !== 3) return null;
  const catches = run.turns.map(turn => turn.prizeId === 'sprout' ? '⭐' : turn.prizeId ? '🧸' : '—').join(' ');
  return {
    title: 'Claw · Three turns',
    text: `${run.name} scored ${run.total} in Claw!\n${catches}\nThree turns. Can you beat it?`,
    // Never share setup flags, host paths or browser-owned run credentials.
    url: new URL('/', origin).href,
  };
}
