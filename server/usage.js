// Coarse, advisory classification only. Never retain the raw browser header.
export function deviceClass(userAgent = '') {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 1024) : '';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'phone';
  if (/Windows NT|Macintosh|X11|CrOS/i.test(ua)) return 'desktop';
  return 'unknown';
}
