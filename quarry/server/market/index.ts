import type { DB } from '../db/index.ts';
import type { AppConfig } from '../config.ts';
import { NoMarketDataProvider, type MarketDataProvider } from './provider.ts';
import { DemoMarketDataProvider } from './demo.ts';
import { AlphaVantageProvider, PolygonProvider } from './http.ts';

export function createMarketProvider(config: AppConfig, db: DB): MarketDataProvider {
  // Simulated prices are only ever paired with the simulated (demo) dataset.
  if (config.dataset === 'demo') return new DemoMarketDataProvider(db);
  switch (config.marketProvider) {
    case 'polygon': return new PolygonProvider(config.marketApiKey, config.marketDelayMinutes);
    case 'alphavantage': return new AlphaVantageProvider(config.marketApiKey, config.marketDelayMinutes);
    default: return new NoMarketDataProvider();
  }
}
