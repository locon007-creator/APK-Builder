import type { DB } from '../db/index.ts';
import { all } from '../db/index.ts';
import type { MarketQuote, PriceBar, ProviderStatus } from '../../shared/types.ts';
import { type MarketDataProvider, type PriceHistory, quoteFromHistory } from './provider.ts';

/** Serves the generated price series stored with the demo dataset. Always labelled simulated. */
export class DemoMarketDataProvider implements MarketDataProvider {
  readonly id = 'demo';
  constructor(private readonly db: DB) {}
  status(): ProviderStatus {
    return { id: 'demo', name: 'Demo price generator', configured: true, isDemo: true, delay: 'simulated', message: 'Prices and volumes are simulated for demonstration. They are not market observations.' };
  }
  async getHistory(ticker: string, from: string, to: string): Promise<PriceHistory | null> {
    const bars = all<PriceBar>(this.db, `SELECT date, open, high, low, close, volume FROM prices WHERE ticker = ? AND provider = 'demo' AND date >= ? AND date <= ? ORDER BY date`, ticker.toUpperCase(), from.slice(0, 10), to.slice(0, 10));
    if (!bars.length) return null;
    return { ticker: ticker.toUpperCase(), bars, provider: 'demo', isDemo: true, delay: 'simulated', delayMinutes: null, observedAt: `${bars[bars.length - 1].date}T21:00:00.000Z`, adjusted: true };
  }
  async getQuote(ticker: string, asOf: string): Promise<MarketQuote | null> {
    const from = new Date(new Date(asOf).getTime() - 10 * 86_400_000).toISOString();
    return quoteFromHistory(await this.getHistory(ticker, from, asOf));
  }
}
