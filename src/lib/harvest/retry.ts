import { randomUserAgent } from './userAgents';
import { proxiedFetch } from './proxyPool';

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  retries = 3,
  delay = 1000
): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      const headers = new Headers(init.headers || {});
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', randomUserAgent());
      }
      if (!headers.has('Accept')) headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en-US,en;q=0.9');
      if (!headers.has('Referer')) headers.set('Referer', 'https://www.google.com/');
      
      const res = await proxiedFetch(url, { ...init, headers });
      if (res.status >= 500 || res.status === 429 || res.status === 403) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}
