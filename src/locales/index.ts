import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

type Locale = Record<string, any>;

let locale: Locale = {};

function load(): void {
  const lang = config.locale;
  const dir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  const path = join(dir, `${lang}.json`);
  try {
    locale = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    locale = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf-8'));
  }
}

export function getLocale(): Locale {
  if (!Object.keys(locale).length) load();
  return locale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let val: any = getLocale();
  for (const part of key.split('.')) {
    val = val?.[part];
    if (val === undefined) return key;
  }
  if (typeof val !== 'string') return key;
  if (params) {
    return val.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
  }
  return val;
}

export function reload(): void {
  locale = {};
  load();
}
