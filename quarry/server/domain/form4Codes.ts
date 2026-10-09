import type { InsiderClass } from '../../shared/types.ts';

// SEC Form 4 transaction codes (General Instruction 8 to Form 4).
export const FORM4_CODES: Record<string, { label: string; cls: InsiderClass }> = {
  P: { label: 'Open-market or private purchase', cls: 'open_market_purchase' },
  S: { label: 'Open-market or private sale', cls: 'open_market_sale' },
  V: { label: 'Transaction voluntarily reported earlier than required', cls: 'other' },
  A: { label: 'Grant, award or other acquisition from the issuer', cls: 'award' },
  D: { label: 'Disposition to the issuer', cls: 'disposition_to_issuer' },
  F: { label: 'Shares withheld to pay exercise price or tax', cls: 'tax_withholding' },
  I: { label: 'Discretionary transaction (Rule 16b-3(f))', cls: 'other' },
  M: { label: 'Exercise or conversion of exempt derivative', cls: 'option_exercise' },
  C: { label: 'Conversion of derivative security', cls: 'conversion' },
  E: { label: 'Expiration of short derivative position', cls: 'other' },
  H: { label: 'Expiration or cancellation of long derivative position', cls: 'other' },
  O: { label: 'Exercise of out-of-the-money derivative', cls: 'option_exercise' },
  X: { label: 'Exercise of in- or at-the-money derivative', cls: 'option_exercise' },
  G: { label: 'Bona fide gift', cls: 'gift' },
  L: { label: 'Small acquisition (Rule 16a-6)', cls: 'other' },
  W: { label: 'Acquisition or disposition by will or laws of descent', cls: 'other' },
  Z: { label: 'Deposit into or withdrawal from voting trust', cls: 'other' },
  J: { label: 'Other acquisition or disposition (see footnotes)', cls: 'other' },
  K: { label: 'Equity swap or similar instrument', cls: 'other' },
  U: { label: 'Disposition due to a tender of shares in a change-of-control', cls: 'other' },
};

export const CLASS_LABELS: Record<InsiderClass, string> = {
  open_market_purchase: 'Open-market purchase',
  open_market_sale: 'Open-market sale',
  award: 'Equity award',
  option_exercise: 'Option exercise',
  tax_withholding: 'Tax withholding',
  gift: 'Gift',
  disposition_to_issuer: 'Disposition to issuer',
  conversion: 'Conversion',
  other: 'Other reportable',
};

export function classifyForm4(code: string, isDerivative: boolean): { cls: InsiderClass; label: string; codeLabel: string } {
  const c = code.trim().toUpperCase();
  const entry = FORM4_CODES[c];
  if (!entry) return { cls: 'other', label: CLASS_LABELS.other, codeLabel: `Unrecognised code "${c}"` };
  // A "P"/"S" in the derivative table is a purchase/sale of a derivative (e.g. options), not common stock.
  if (isDerivative && (entry.cls === 'open_market_purchase' || entry.cls === 'open_market_sale')) {
    return { cls: 'other', label: `Derivative ${c === 'P' ? 'purchase' : 'sale'}`, codeLabel: entry.label };
  }
  return { cls: entry.cls, label: CLASS_LABELS[entry.cls], codeLabel: entry.label };
}

/**
 * A "qualifying" insider purchase for research signals: non-derivative code P,
 * acquired (A), positive shares, a disclosed price, and not part of a 10b5-1 plan.
 */
export function isQualifyingOpenMarketPurchase(t: {
  code: string; isDerivative: boolean; acquiredDisposed: string; shares: number; price: number | null; is10b51?: boolean;
}): boolean {
  return t.code.toUpperCase() === 'P' && !t.isDerivative && t.acquiredDisposed === 'A' && t.shares > 0 && t.price != null && t.price > 0 && !t.is10b51;
}
