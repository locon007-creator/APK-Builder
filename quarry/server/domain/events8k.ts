// Form 8-K item taxonomy with a documented research-relevance weight (0..1).
// Weights are editorial judgements about how often an item warrants follow-up
// research; they are not predictions of price impact.
export const ITEMS_8K: Record<string, { label: string; relevance: number }> = {
  '1.01': { label: 'Entry into a material definitive agreement', relevance: 0.7 },
  '1.02': { label: 'Termination of a material definitive agreement', relevance: 0.7 },
  '1.03': { label: 'Bankruptcy or receivership', relevance: 1.0 },
  '1.05': { label: 'Material cybersecurity incident', relevance: 0.9 },
  '2.01': { label: 'Completion of acquisition or disposition of assets', relevance: 0.8 },
  '2.02': { label: 'Results of operations and financial condition (earnings)', relevance: 0.8 },
  '2.03': { label: 'Creation of a direct financial obligation', relevance: 0.5 },
  '2.04': { label: 'Triggering events that accelerate an obligation', relevance: 0.8 },
  '2.05': { label: 'Costs associated with exit or disposal activities', relevance: 0.6 },
  '2.06': { label: 'Material impairments', relevance: 0.7 },
  '3.01': { label: 'Delisting notice or failure to satisfy listing rule', relevance: 0.9 },
  '3.02': { label: 'Unregistered sales of equity securities', relevance: 0.5 },
  '3.03': { label: 'Material modification to rights of security holders', relevance: 0.6 },
  '4.01': { label: "Change in registrant's certifying accountant", relevance: 0.7 },
  '4.02': { label: 'Non-reliance on previously issued financial statements', relevance: 1.0 },
  '5.01': { label: 'Change in control of registrant', relevance: 1.0 },
  '5.02': { label: 'Departure or appointment of directors or officers', relevance: 0.6 },
  '5.03': { label: 'Amendments to articles or bylaws; fiscal-year change', relevance: 0.3 },
  '5.07': { label: 'Submission of matters to a vote of security holders', relevance: 0.3 },
  '7.01': { label: 'Regulation FD disclosure', relevance: 0.4 },
  '8.01': { label: 'Other events', relevance: 0.4 },
  '9.01': { label: 'Financial statements and exhibits', relevance: 0.1 },
};

export function describeItems(items: string[]): { code: string; label: string; relevance: number }[] {
  return items
    .map((c) => c.trim())
    .filter(Boolean)
    .map((code) => ({ code, label: ITEMS_8K[code]?.label ?? `Item ${code}`, relevance: ITEMS_8K[code]?.relevance ?? 0.3 }));
}

/** Relevance of an 8-K = its most relevant item (exhibit-only item 9.01 does not add). */
export function eventRelevance(items: string[]): number {
  const d = describeItems(items);
  return d.length ? Math.max(...d.map((i) => i.relevance)) : 0;
}

export function headlineFor8K(items: string[]): string {
  const d = describeItems(items).filter((i) => i.code !== '9.01').sort((a, b) => b.relevance - a.relevance);
  return d[0]?.label ?? 'Current report (exhibits only)';
}
