// Rate-limited, retrying HTTP client for SEC EDGAR.
// SEC fair-access policy: declare a User-Agent with contact details and stay
// under 10 requests/second. 429/503 responses are retried with backoff and
// Retry-After is honoured.

export interface SecClientOptions {
  userAgent: string;
  maxRps?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export class SecHttpError extends Error {
  constructor(public url: string, public status: number, message: string) {
    super(message);
  }
}

export class SecClient {
  private readonly minIntervalMs: number;
  private nextSlot = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  public requests = 0;

  constructor(private readonly opts: SecClientOptions) {
    if (!opts.userAgent || !/@/.test(opts.userAgent)) {
      throw new Error('SEC_USER_AGENT must be set to "Company Name contact@email" per SEC fair-access policy.');
    }
    const rps = Math.min(Math.max(opts.maxRps ?? 8, 1), 10);
    this.minIntervalMs = Math.ceil(1000 / rps);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextSlot - now);
    this.nextSlot = Math.max(now, this.nextSlot) + this.minIntervalMs;
    if (wait > 0) await this.sleep(wait);
  }

  async get(url: string): Promise<{ status: number; text: string }> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let attempt = 0;
    for (;;) {
      await this.throttle();
      this.requests++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { 'User-Agent': this.opts.userAgent, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json, text/xml, text/html, */*' },
        });
      } catch (err) {
        if (attempt >= maxRetries) throw new SecHttpError(url, 0, `Network error after ${attempt + 1} attempts: ${(err as Error).message}`);
        await this.sleep(this.backoff(attempt++));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) throw new SecHttpError(url, res.status, `HTTP ${res.status} after ${attempt + 1} attempts`);
        const ra = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.backoff(attempt);
        this.opts.log?.(`SEC ${res.status} for ${url}; retrying in ${delay}ms`);
        attempt++;
        await this.sleep(delay);
        continue;
      }
      if (res.status === 404) throw new SecHttpError(url, 404, 'Not found');
      if (!res.ok) throw new SecHttpError(url, res.status, `HTTP ${res.status}`);
      return { status: res.status, text: await res.text() };
    }
  }

  async getJson<T>(url: string): Promise<T> {
    const { text } = await this.get(url);
    return JSON.parse(text) as T;
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 1000 * 2 ** attempt);
  }
}
