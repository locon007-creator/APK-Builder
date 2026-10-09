import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  dataset: 'demo' | 'sec';
  dbPath: string;
  secUserAgent: string;
  secMaxRps: number;
  universePath: string;
  marketProvider: 'none' | 'polygon' | 'alphavantage';
  marketApiKey: string;
  marketDelayMinutes: number;
  alertWebhookUrl: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataset = env.QUARRY_DATASET === 'sec' ? 'sec' : 'demo';
  const provider = (env.MARKET_DATA_PROVIDER ?? 'none').toLowerCase();
  return {
    port: Number(env.PORT ?? 8787),
    dataset,
    dbPath: resolve(env.QUARRY_DB_PATH ?? (dataset === 'demo' ? './data/demo.db' : './data/quarry.db')),
    secUserAgent: env.SEC_USER_AGENT ?? '',
    secMaxRps: Number(env.SEC_MAX_RPS ?? 8),
    universePath: resolve(env.QUARRY_UNIVERSE ?? './config/universe.json'),
    marketProvider: provider === 'polygon' || provider === 'alphavantage' ? provider : 'none',
    marketApiKey: env.MARKET_DATA_API_KEY ?? '',
    marketDelayMinutes: Number(env.MARKET_DATA_DELAY_MINUTES ?? 15),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL ?? '',
    production: env.NODE_ENV === 'production',
  };
}
