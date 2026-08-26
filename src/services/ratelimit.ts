const cooldowns = new Map<string, number>();

export function checkCooldown(key: string, seconds: number): boolean {
  const now = Date.now();
  const expires = cooldowns.get(key);
  if (expires && now < expires) return true;

  cooldowns.set(key, now + seconds * 1000);
  return false;
}

export function getRemaining(key: string): number {
  const expires = cooldowns.get(key);
  if (!expires) return 0;
  const remaining = expires - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function clearCooldown(key: string): void {
  cooldowns.delete(key);
}

const hits = new Map<string, number[]>();

/** Sliding-window flood check: records a hit for `key` and reports whether more than `max` hits landed within the trailing `windowMs`. */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
