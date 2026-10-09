import type { MarketQuote, PriceBar, ProviderStatus } from '../../shared/types.ts';

export interface PriceHistory {
  ticker: string;
  bars: PriceBar[];
  provider: string;
  isDemo: boolean;
  delay: MarketQuote['delay'];
  delayMinutes: number | null;
  /** When the most recent bar was observed (bar date close for daily data). */
  observedAt: string | null;
  adjusted: boolean;
}

/**
 * Replaceable market-data integration. Implementations must:
 *  - never return data dated after the requested cutoff (look-ahead protection);
 *  - declare whether data is simulated, delayed, end-of-day or real-time;
 *  - return null (not fabricated values) when data is unavailable.
 */
export interface MarketDataProvider {
  readonly id: string;
  status(): ProviderStatus;
  getHistory(ticker: string, from: string, to: string): Promise<PriceHistory | null>;
  getQuote(ticker: string, asOf: string): Promise<MarketQuote | null>;
}

export function quoteFromHistory(h: PriceHistory | null): MarketQuote | null {
  if (!h || !h.bars.length) return null;
  const last = h.bars[h.bars.length - 1];
  const prev = h.bars.length > 1 ? h.bars[h.bars.length - 2] : null;
  return {
    ticker: h.ticker,
    price: last.close,
    change: prev ? last.close - prev.close : null,
    changePct: prev && prev.close ? (last.close - prev.close) / prev.close : null,
    asOf: h.observedAt ?? `${last.date}T21:00:00.000Z`,
    delay: h.delay,
    delayMinutes: h.delayMinutes,
    provider: h.provider,
    isDemo: h.isDemo,
  };
}

export class NoMarketDataProvider implements MarketDataProvider {
  readonly id = 'none';
  status(): ProviderStatus {
    return {
      id: 'none', name: 'No provider', configured: false, isDemo: false, delay: 'none',
      message: 'No market-data provider configured. Price, volume, chart and unusual-activity features are unavailable. Set MARKET_DATA_PROVIDER and MARKET_DATA_API_KEY to enable them.',
    };
  }
  async getHistory(): Promise<PriceHistory | null> { return null; }
  async getQuote(): Promise<MarketQuote | null> { return null; }
}
