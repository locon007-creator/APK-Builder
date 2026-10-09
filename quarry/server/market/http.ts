import type { MarketQuote, PriceBar, ProviderStatus } from '../../shared/types.ts';
import { type MarketDataProvider, type PriceHistory, quoteFromHistory } from './provider.ts';

interface CacheEntry { at: number; value: PriceHistory | null }

abstract class HttpProvider implements MarketDataProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  private cache = new Map<string, CacheEntry>();
  constructor(protected readonly apiKey: string, protected readonly delayMinutes: number, protected readonly fetchImpl: typeof fetch = fetch) {}
  status(): ProviderStatus {
    return {
      id: this.id, name: this.name, configured: !!this.apiKey, isDemo: false,
      delay: 'end_of_day',
      message: this.apiKey ? `Daily bars from ${this.name}. Corporate-action adjusted. Latest bar is end-of-day (plan delay ~${this.delayMinutes} min).` : `${this.name} selected but MARKET_DATA_API_KEY is missing.`,
    };
  }
  protected abstract fetchBars(ticker: string, from: string, to: string): Promise<PriceBar[]>;
  async getHistory(ticker: string, from: string, to: string): Promise<PriceHistory | null> {
    if (!this.apiKey) return null;
    const key = `${ticker}|${from.slice(0, 10)}|${to.slice(0, 10)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
    let value: PriceHistory | null = null;
    try {
      const cutoff = to.slice(0, 10);
      // Look-ahead protection: drop anything after the cutoff even if the provider returns it.
      const bars = (await this.fetchBars(ticker.toUpperCase(), from.slice(0, 10), cutoff)).filter((b) => b.date <= cutoff);
      value = bars.length ? { ticker: ticker.toUpperCase(), bars, provider: this.id, isDemo: false, delay: 'end_of_day', delayMinutes: this.delayMinutes, observedAt: `${bars[bars.length - 1].date}T21:00:00.000Z`, adjusted: true } : null;
    } catch {
      value = null;
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
  async getQuote(ticker: string, asOf: string): Promise<MarketQuote | null> {
    const from = new Date(new Date(asOf).getTime() - 10 * 86_400_000).toISOString();
    return quoteFromHistory(await this.getHistory(ticker, from, asOf));
  }
}

/** Polygon.io aggregates API (daily bars, adjusted). */
export class PolygonProvider extends HttpProvider {
  readonly id = 'polygon';
  readonly name = 'Polygon.io';
  protected async fetchBars(ticker: string, from: string, to: string): Promise<PriceBar[]> {
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Polygon HTTP ${res.status}`);
    const json = (await res.json()) as { results?: { t: number; o: number; h: number; l: number; c: number; v: number }[] };
    return (json.results ?? []).map((r) => ({ date: new Date(r.t).toISOString().slice(0, 10), open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v }));
  }
}

/** Alpha Vantage TIME_SERIES_DAILY_ADJUSTED. */
export class AlphaVantageProvider extends HttpProvider {
  readonly id = 'alphavantage';
  readonly name = 'Alpha Vantage';
  protected async fetchBars(ticker: string, from: string, to: string): Promise<PriceBar[]> {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, Record<string, Record<string, string>>>;
    const series = json['Time Series (Daily)'];
    if (!series) throw new Error('Alpha Vantage: no time series (rate limit or invalid key)');
    return Object.entries(series)
      .filter(([d]) => d >= from && d <= to)
      .map(([date, v]) => {
        const close = Number(v['4. close']);
        const adj = Number(v['5. adjusted close'] ?? close);
        const f = close ? adj / close : 1; // apply split/dividend adjustment factor to OHLC
        return { date, open: Number(v['1. open']) * f, high: Number(v['2. high']) * f, low: Number(v['3. low']) * f, close: adj, volume: Number(v['6. volume'] ?? v['5. volume']) };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
