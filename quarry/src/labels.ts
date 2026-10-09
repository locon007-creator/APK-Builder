import type { RadarCategory } from '../shared/types.ts';

export const CATEGORY_LABELS: Record<RadarCategory, string> = {
  institutional_accumulation: 'Institutional accumulation',
  new_positions: 'New positions',
  broad_interest: 'Broad-based interest',
  institutional_reduction: 'Institutional reduction',
  insider_buying: 'Insider buying',
  activist: 'Activist activity',
  corporate_events: 'Corporate events',
  unusual_market: 'Unusual market activity',
};

export const POSITIONING: RadarCategory[] = ['institutional_accumulation', 'new_positions', 'broad_interest', 'institutional_reduction'];
export const EVENT: RadarCategory[] = ['insider_buying', 'activist', 'corporate_events', 'unusual_market'];

export const PRESET_LABELS: Record<string, string> = {
  new_positions: 'New institutional positions',
  broad_adds: 'Broad-based reported adds',
  largest_share_increases: 'Largest share-count increases',
  largest_weight_increases: 'Largest portfolio-weight increases',
  recent_insider_purchases: 'Recent insider purchases',
  institutional_reductions: 'Institutional reductions',
  activist: 'Recent activist disclosures',
  corporate_events: 'Corporate event watch',
  watchlist: 'Watchlist developments',
};

export const RULE_LABELS: Record<string, string> = {
  new_filing: 'Newly accepted filing',
  new_position: 'New reported 13F position',
  share_change: 'Material 13F share-count change',
  insider_purchase: 'Insider open-market purchase',
  ownership_disclosure: 'Schedule 13D / 13G disclosure',
  corporate_event: 'Selected 8-K corporate event',
};
