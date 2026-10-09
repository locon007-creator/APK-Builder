// Types shared by the API server and the web client.
// Every timestamp is an ISO-8601 string. Field names deliberately keep the
// different "times" of a fact apart: period, transaction, filing, acceptance,
// ingestion, market observation and analysis.

export type DataOrigin = 'sec' | 'demo';

export type FreshnessStatus =
  | 'recently_filed'
  | 'historical'
  | 'market'
  | 'demo'
  | 'unavailable'
  | 'stale';

export interface Freshness {
  status: FreshnessStatus;
  label: string;
  reason: string;
  /** True whenever the underlying record is simulated. */
  isDemo: boolean;
}

export interface FilingRef {
  accession: string;
  formType: string;
  baseForm: string;
  isAmendment: boolean;
  amendmentType: string | null;
  filerCik: string;
  filerName: string | null;
  subjectCik: string | null;
  subjectName: string | null;
  periodOfReport: string | null;
  filingDate: string;
  acceptedAt: string;
  ingestedAt: string;
  sourceUrl: string | null;
  parseStatus: string;
  parserVersion: string;
  origin: DataOrigin;
  items: string[];
  freshness: Freshness;
}

export type PositionChangeKind = 'new' | 'increased' | 'reduced' | 'exited' | 'unchanged';

export interface PositionChange {
  managerCik: string;
  managerName: string;
  cusip: string;
  issuerCik: string | null;
  ticker: string | null;
  issuerName: string;
  period: string;
  priorPeriod: string | null;
  kind: PositionChangeKind;
  sharesPrior: number;
  sharesCurrent: number;
  shareChange: number;
  shareChangePct: number | null;
  valuePrior: number;
  valueCurrent: number;
  valueChange: number;
  /** Portion of the value change attributable to changed share counts (at prior implied price). */
  valueChangeFromShares: number;
  /** Portion of the value change attributable to the change in implied per-share value. */
  valueChangeFromPrice: number;
  weightPrior: number | null;
  weightCurrent: number | null;
  weightChange: number | null;
  filingAccession: string;
  filingAcceptedAt: string;
  priorFilingAccession: string | null;
  origin: DataOrigin;
}

export type InsiderClass =
  | 'open_market_purchase'
  | 'open_market_sale'
  | 'award'
  | 'option_exercise'
  | 'tax_withholding'
  | 'gift'
  | 'disposition_to_issuer'
  | 'conversion'
  | 'other';

export interface InsiderTransaction {
  id: number;
  accession: string;
  issuerCik: string;
  ticker: string | null;
  issuerName: string;
  ownerCik: string;
  ownerName: string;
  ownerRole: string;
  securityTitle: string;
  isDerivative: boolean;
  transactionDate: string;
  code: string;
  codeLabel: string;
  classification: InsiderClass;
  classificationLabel: string;
  acquiredDisposed: 'A' | 'D';
  shares: number;
  price: number | null;
  value: number | null;
  sharesOwnedAfter: number | null;
  directOrIndirect: 'D' | 'I';
  is10b51: boolean;
  acceptedAt: string;
  filingDate: string;
  sourceUrl: string | null;
  origin: DataOrigin;
}

export interface CorporateEvent {
  accession: string;
  issuerCik: string;
  ticker: string | null;
  issuerName: string;
  formType: string;
  eventDate: string | null;
  acceptedAt: string;
  items: { code: string; label: string; relevance: number }[];
  headline: string;
  category: 'corporate_event' | 'activist' | 'passive_ownership';
  percentOfClass: number | null;
  filerName: string | null;
  isAmendment: boolean;
  sourceUrl: string | null;
  origin: DataOrigin;
}

export type RadarCategory =
  | 'institutional_accumulation'
  | 'new_positions'
  | 'broad_interest'
  | 'insider_buying'
  | 'activist'
  | 'corporate_events'
  | 'unusual_market'
  | 'institutional_reduction';

export type ResearchMode = 'positioning' | 'event';

export interface RankingInput {
  key: string;
  label: string;
  weight: number;
  /** Normalised 0..1 contribution, or null when the input is missing. */
  normalized: number | null;
  raw: string;
  formula: string;
}

export interface Ranking {
  score: number;
  coverage: number;
  method: string;
  inputs: RankingInput[];
  missing: string[];
  computedAt: string;
  asOf: string;
  limitations: string[];
}

export interface Evidence {
  kind: 'filing' | 'position_change' | 'insider_transaction' | 'event' | 'market';
  summary: string;
  accession: string | null;
  acceptedAt: string | null;
  periodOfReport: string | null;
  eventDate: string | null;
  sourceUrl: string | null;
  origin: DataOrigin;
}

export interface RadarCandidate {
  id: string;
  category: RadarCategory;
  mode: ResearchMode;
  issuerCik: string;
  ticker: string | null;
  issuerName: string;
  sector: string | null;
  marketCap: number | null;
  headline: string;
  supportingCount: number;
  eventDate: string | null;
  latestAcceptedAt: string;
  periodOfReport: string | null;
  freshness: Freshness;
  whatChanged: string;
  whyItMatters: string;
  verifyNext: string[];
  limitations: string[];
  evidence: Evidence[];
  ranking: Ranking;
  formTypes: string[];
  hasMarketConfirmation: boolean;
  onWatchlist: boolean;
  origin: DataOrigin;
}

export interface MarketQuote {
  ticker: string;
  price: number;
  change: number | null;
  changePct: number | null;
  asOf: string;
  delay: 'real_time' | 'delayed' | 'end_of_day' | 'simulated';
  delayMinutes: number | null;
  provider: string;
  isDemo: boolean;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  isDemo: boolean;
  delay: MarketQuote['delay'] | 'none';
  message: string;
}

export interface DatasetInfo {
  dataset: 'demo' | 'sec';
  isDemo: boolean;
  asOf: string;
  now: string;
  latestAcceptedAt: string | null;
  latestIngestedAt: string | null;
  market: ProviderStatus;
  delivery: { inApp: true; webhook: boolean };
}

export type AlertRuleType =
  | 'new_filing'
  | 'new_position'
  | 'share_change'
  | 'insider_purchase'
  | 'ownership_disclosure'
  | 'corporate_event';

export interface AlertRule {
  id: number;
  name: string;
  type: AlertRuleType;
  targetKind: 'stock' | 'manager' | 'any';
  targetId: string | null;
  threshold: number | null;
  eventItems: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRecord {
  id: number;
  ruleId: number;
  ruleName: string;
  title: string;
  body: string;
  triggerEvent: string;
  source: string;
  accession: string | null;
  sourceUrl: string | null;
  filingAcceptedAt: string | null;
  detectedAt: string;
  deliveryStatus: { channel: string; status: string; detail: string }[];
  limitations: string[];
  readAt: string | null;
  origin: DataOrigin;
}

export interface WatchItem {
  kind: 'stock' | 'manager' | 'category';
  id: string;
  label: string;
  addedAt: string;
}
