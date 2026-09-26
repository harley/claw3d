import { isIP, BlockList } from 'node:net';
import { ApiError } from './database.js';

// Normalize equivalent IPv6 spellings and IPv4-mapped peers before keying budgets.
export function address(value) {
  if (typeof value !== 'string' || !isIP(value) || value.includes('%')) return null;
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  return mapped ? [...mapped.slice(1).flatMap(part => [parseInt(part, 16) >> 8, parseInt(part, 16) & 255])].join('.') : normalized;
}

export function clientAddressResolver(trustedProxyPeers = []) {
  if (!Array.isArray(trustedProxyPeers) || trustedProxyPeers.length > 32) throw new Error('Invalid trusted proxy peers.');
  const peers = new BlockList();
  for (const peer of trustedProxyPeers) {
    const ip = address(peer);
    if (!ip) throw new Error('Trusted proxy peers must be exact IP addresses.');
    peers.addAddress(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6');
  }
  return req => {
    const peer = address(req.socket.remoteAddress);
    if (!peer) return 'unknown-peer';
    if (!peers.check(peer, isIP(peer) === 4 ? 'ipv4' : 'ipv6')) return peer;
    // Only a configured immediate peer may supply one X-Real-IP. Never walk XFF.
    return address(req.headers['x-real-ip']) || 'unknown-proxy-client';
  };
}

export function throttled(seconds = 60) {
  const error = new ApiError(429, 'Too many attempts. Try again later.');
  error.retryAfter = Math.max(1, Math.ceil(seconds));
  return error;
}

// Fixed windows, bounded keys, no eviction of live entries and no timer per caller.
export function createBudget({ now = Date.now, maxKeys = 10_000 } = {}) {
  if (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 10_000) throw new Error('Invalid budget capacity.');
  const entries = new Map();
  function prune() { const time = now(); for (const [key, entry] of entries) if (entry.until <= time) entries.delete(key); }
  return {
    get size() { return entries.size; }, prune,
    take(key, maximum) {
      if (typeof key !== 'string' || key.length > 160 || !Number.isInteger(maximum) || maximum < 1) throw new Error('Invalid budget key or limit.');
      const time = now(); let entry = entries.get(key);
      if (!entry || entry.until <= time) {
        if (!entry && entries.size >= maxKeys) {
          prune();
          if (entries.size >= maxKeys) throw throttled();
        }
        entry = { count: 0, until: time + 60_000 }; entries.set(key, entry);
      }
      if (entry.count >= maximum) throw throttled((entry.until - time) / 1000);
      entry.count++;
    },
  };
}
