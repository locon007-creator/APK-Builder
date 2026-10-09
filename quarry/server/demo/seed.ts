// Deterministic demo dataset. Every company, manager, person, filing and price
// here is FICTIONAL and stored with origin = 'demo'. CIKs use the 9xxxxxxxxx range
// (unused by EDGAR) and accession numbers use the 99xxxxxxxx filer prefix.
//
// The seeder writes EDGAR-format XML and runs it through the production parsers
// and storage layer, so the demo exercises the same code paths as live data.

import type { DB } from '../db/index.ts';
import { setMeta, tx } from '../db/index.ts';
import { storeFiling, upsertEntity, upsertSecurity, write13FRows, writeForm4Rows, writeOwnershipDisclosure } from '../sec/store.ts';
import { parse13FCover, parse13FInformationTable, PARSER_13F_VERSION, validate13F } from '../sec/parse13f.ts';
import { parseForm4, PARSER_FORM4_VERSION } from '../sec/parseForm4.ts';
import { parseSchedule13Xml, PARSER_SCHEDULE13_VERSION } from '../sec/parseSchedule13.ts';
import { coverXml, form4Xml, infoTableXml, schedule13Xml, type Form4Txn } from './xmlgen.ts';
import { quarterEndOnOrBefore, previousQuarterEnd, addDays } from '../domain/asof.ts';
import { clear13FCache } from '../domain/thirteenF.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_MANAGERS = [
  { cik: '9000000001', name: 'Harborline Capital Partners (Demo)' },
  { cik: '9000000002', name: 'Granite Arch Investors (Demo)' },
  { cik: '9000000003', name: 'Meridian Ridge Asset Management (Demo)' },
  { cik: '9000000004', name: 'Lanternfish Value Fund (Demo)' },
  { cik: '9000000005', name: 'Copperleaf Advisors (Demo)' },
  { cik: '9000000006', name: 'Northwind Holdings Trust (Demo)' },
  { cik: '9000000007', name: 'Bellwether Quantitative (Demo)' },
  { cik: '9000000008', name: 'Sablewood Partners (Demo)' },
];

export const DEMO_ISSUERS = [
  { cik: '9100000001', ticker: 'AURS', name: 'Aurelia Systems Inc. (Demo)', sector: 'Technology', px: 142, sharesOut: 410e6, desc: 'Enterprise workflow software (fictional).' },
  { cik: '9100000002', ticker: 'QSMI', name: 'Quillon Semiconductor Corp. (Demo)', sector: 'Technology', px: 88, sharesOut: 620e6, desc: 'Analog and power semiconductors (fictional).' },
  { cik: '9100000003', ticker: 'BWVC', name: 'Brightwave Cloud Holdings (Demo)', sector: 'Technology', px: 54, sharesOut: 300e6, desc: 'Cloud infrastructure services (fictional).' },
  { cik: '9100000004', ticker: 'CRVT', name: 'Corvane Therapeutics (Demo)', sector: 'Health Care', px: 37, sharesOut: 180e6, desc: 'Clinical-stage biotechnology (fictional).' },
  { cik: '9100000005', ticker: 'HLMD', name: 'Halcyon Medical Devices (Demo)', sector: 'Health Care', px: 116, sharesOut: 150e6, desc: 'Surgical robotics (fictional).' },
  { cik: '9100000006', ticker: 'IBBK', name: 'Ironbridge Bancorp (Demo)', sector: 'Financials', px: 41, sharesOut: 260e6, desc: 'Regional commercial bank (fictional).' },
  { cik: '9100000007', ticker: 'TSPY', name: 'Tessera Payments Inc. (Demo)', sector: 'Financials', px: 73, sharesOut: 340e6, desc: 'Merchant payment processing (fictional).' },
  { cik: '9100000008', ticker: 'RMSE', name: 'Redmarsh Energy Co. (Demo)', sector: 'Energy', px: 62, sharesOut: 500e6, desc: 'Integrated oil and gas (fictional).' },
  { cik: '9100000009', ticker: 'SLNR', name: 'Solenne Renewables (Demo)', sector: 'Utilities', px: 29, sharesOut: 220e6, desc: 'Utility-scale solar developer (fictional).' },
  { cik: '9100000010', ticker: 'MRLW', name: 'Marlow & Finch Outfitters (Demo)', sector: 'Consumer Discretionary', px: 48, sharesOut: 120e6, desc: 'Specialty apparel retail (fictional).' },
  { cik: '9100000011', ticker: 'PCFD', name: 'Pinecrest Foods Inc. (Demo)', sector: 'Consumer Staples', px: 67, sharesOut: 280e6, desc: 'Packaged foods (fictional).' },
  { cik: '9100000012', ticker: 'AKIN', name: 'Atlas Kinetic Industries (Demo)', sector: 'Industrials', px: 95, sharesOut: 210e6, desc: 'Industrial automation equipment (fictional).' },
  { cik: '9100000013', ticker: 'VRDR', name: 'Veridian Rail Corp. (Demo)', sector: 'Industrials', px: 158, sharesOut: 190e6, desc: 'Freight railroad (fictional).' },
  { cik: '9100000014', ticker: 'ORBM', name: 'Orbitale Media Group (Demo)', sector: 'Communication Services', px: 22, sharesOut: 400e6, desc: 'Streaming and broadcast media (fictional).' },
  { cik: '9100000015', ticker: 'SGRT', name: 'Stonegate Realty Trust (Demo)', sector: 'Real Estate', px: 34, sharesOut: 260e6, desc: 'Industrial REIT (fictional).' },
  { cik: '9100000016', ticker: 'CBLM', name: 'Cobaltline Materials (Demo)', sector: 'Materials', px: 51, sharesOut: 170e6, desc: 'Battery metals producer (fictional).' },
];

const cusipFor = (i: number) => `9D${String(i + 1).padStart(4, '0')}10${(i % 10)}`; // 9-char fictional CUSIP

export interface SeedSummary { anchor: string; periods: string[]; filings: number; prices: number }

export function seedDemo(db: DB, anchorDate: Date): SeedSummary {
  const anchor = anchorDate.toISOString();
  const rand = rng(20251231);
  let filingCount = 0;
  let accSeq = 0;
  const acc = (filerCik: string, yearIso: string) => `99${filerCik.slice(-8)}-${yearIso.slice(2, 4)}-${String(++accSeq).padStart(6, '0')}`;
  const at = (iso: string, hour = 20, minute = 0) => `${iso.slice(0, 10)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;

  // Last quarter whose 45-day deadline has passed, plus three earlier quarters.
  let p4 = quarterEndOnOrBefore(anchor);
  if (addDays(`${p4}T00:00:00Z`, 46) > anchor) p4 = previousQuarterEnd(p4);
  const periods = [previousQuarterEnd(previousQuarterEnd(previousQuarterEnd(p4))), previousQuarterEnd(previousQuarterEnd(p4)), previousQuarterEnd(p4), p4];
  const nextPeriod = quarterEndOnOrBefore(anchor) > p4 ? quarterEndOnOrBefore(anchor) : null;

  // ---- Prices: weekday random walks ending at the anchor ------------------
  const start = addDays(anchor, -460).slice(0, 10);
  const days: string[] = [];
  // Only sessions that have closed (21:00 UTC) by the anchor are generated — no bar is ever stamped after the cutoff.
  for (let d = new Date(`${start}T00:00:00Z`); at(d.toISOString(), 21) <= anchor; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(d.toISOString().slice(0, 10));
  }
  const priceBars = new Map<string, { date: string; close: number }[]>();
  const shocks: Record<string, { daysAgo: number; ret: number; vol: number }> = {
    RMSE: { daysAgo: 0, ret: 0.083, vol: 5.2 },
    QSMI: { daysAgo: 0, ret: 0.031, vol: 2.9 },
    SLNR: { daysAgo: 3, ret: -0.12, vol: 4.1 },
  };
  const priceRows: unknown[][] = [];
  DEMO_ISSUERS.forEach((iss, idx) => {
    const r = rng(1000 + idx);
    const drift = (r() - 0.45) * 0.0012;
    const vol = 0.012 + r() * 0.012;
    let px = iss.px * (0.75 + r() * 0.2);
    const baseVol = (iss.sharesOut * (0.004 + r() * 0.004));
    const bars: { date: string; close: number }[] = [];
    days.forEach((date, k) => {
      const shock = shocks[iss.ticker];
      const isShock = shock && k === days.length - 1 - shock.daysAgo;
      const ret = isShock ? shock.ret : drift + vol * (r() + r() + r() - 1.5) * 1.4;
      const open = px;
      px = Math.max(1, px * (1 + ret));
      const high = Math.max(open, px) * (1 + r() * 0.01);
      const low = Math.min(open, px) * (1 - r() * 0.01);
      const volume = Math.round(baseVol * (0.7 + r() * 0.6) * (isShock ? shock.vol : 1));
      bars.push({ date, close: px });
      priceRows.push([iss.ticker, date, round2(open), round2(high), round2(low), round2(px), volume, at(date, 21), 'demo']);
    });
    priceBars.set(iss.ticker, bars);
  });
  const closeOn = (ticker: string, date: string) => {
    const bars = priceBars.get(ticker)!;
    let c = bars[0].close;
    for (const b of bars) { if (b.date <= date) c = b.close; else break; }
    return c;
  };

  // ---- Holdings scenarios -------------------------------------------------
  // shares[m][issuerIdx][periodIdx] (0 = not held). Periods 0..3 plus optional early filers for nextPeriod (index 4).
  const T = (ticker: string) => DEMO_ISSUERS.findIndex((i) => i.ticker === ticker);
  const holdings: number[][][] = DEMO_MANAGERS.map(() => DEMO_ISSUERS.map(() => [0, 0, 0, 0, 0]));
  DEMO_MANAGERS.forEach((_, m) => {
    DEMO_ISSUERS.forEach((_, i) => {
      if (rand() < 0.55) {
        let s = Math.round((2 + rand() * 40) * 1e5);
        for (let p = 0; p < 5; p++) {
          holdings[m][i][p] = s;
          s = Math.round(s * (1 + (rand() - 0.5) * 0.12)); // drift ±6%
        }
      }
    });
  });
  const set = (m: number, ticker: string, values: number[]) => { holdings[m][T(ticker)] = [...values, values[values.length - 1]]; };
  // Accumulation in AURS by three managers in the latest period.
  set(0, 'AURS', [1.2e6, 1.25e6, 1.3e6, 1.95e6]);
  set(2, 'AURS', [8e5, 8e5, 8.4e5, 1.18e6]);
  set(5, 'AURS', [2.1e6, 2.0e6, 2.2e6, 2.9e6]);
  set(6, 'AURS', [0, 0, 5e5, 5e5]);
  // QSMI: new positions + broad interest (one arrives via a NEW HOLDINGS amendment — Copperleaf, index 4).
  set(1, 'QSMI', [0, 0, 0, 2.4e6]);
  set(3, 'QSMI', [0, 0, 0, 9e5]);
  set(4, 'QSMI', [0, 0, 0, 0]); // added by amendment below
  set(7, 'QSMI', [6e5, 6.2e5, 6.5e5, 1.1e6]);
  set(0, 'QSMI', [3e5, 3e5, 3.1e5, 4.4e5]);
  set(6, 'QSMI', [0, 0, 0, 0]);
  // CRVT: reductions/exits across three managers.
  set(1, 'CRVT', [1.8e6, 1.8e6, 1.7e6, 6e5]);
  set(3, 'CRVT', [9e5, 9e5, 9e5, 0]);
  set(5, 'CRVT', [1.1e6, 1.2e6, 1.2e6, 7e5]);
  set(0, 'CRVT', [0, 0, 0, 0]); set(2, 'CRVT', [0, 0, 0, 0]); set(4, 'CRVT', [0, 0, 0, 0]); set(6, 'CRVT', [0, 0, 0, 0]); set(7, 'CRVT', [0, 0, 0, 0]);
  // AKIN: two exits.
  set(4, 'AKIN', [7e5, 7e5, 6e5, 0]);
  set(7, 'AKIN', [4e5, 4.2e5, 4.2e5, 0]);
  // Price-driven value change without share change (demonstrates decomposition).
  set(2, 'VRDR', [5e5, 5e5, 5e5, 5e5]);
  // IBBK: a single institutional add alongside insider buying.
  set(4, 'IBBK', [1.5e6, 1.5e6, 1.5e6, 2.1e6]);
  // Granite Arch holds TSPY throughout (its Q3 filing is restated below).
  set(1, 'TSPY', [1e6, 1.05e6, 1.1e6, 1.1e6]);
  // Early filers for the in-progress quarter (recently filed 13F).
  const earlyFilers = nextPeriod ? [0, 6] : [];

  const managerFilingTime = (m: number, period: string) => {
    const lag = 38 + ((m * 3 + Number(period.slice(5, 7))) % 7); // 38–44 days after quarter end
    return at(addDays(`${period}T00:00:00Z`, lag), 20, 5 + m * 4);
  };

  return tx(db, () => {
    for (const m of DEMO_MANAGERS) upsertEntity(db, { cik: m.cik, name: m.name, kind: 'manager', tracked: true, origin: 'demo', now: anchor });
    DEMO_ISSUERS.forEach((iss, i) => {
      const lastPx = closeOn(iss.ticker, anchor.slice(0, 10));
      upsertEntity(db, { cik: iss.cik, name: iss.name, kind: 'issuer', tracked: true, ticker: iss.ticker, sector: iss.sector, marketCap: lastPx * iss.sharesOut, marketCapAsOf: anchor.slice(0, 10), description: iss.desc, origin: 'demo', now: anchor });
      upsertSecurity(db, { cusip: cusipFor(i), issuerCik: iss.cik, ticker: iss.ticker, name: iss.name.toUpperCase().replace(' (DEMO)', ''), mappingSource: 'universe', origin: 'demo' });
    });

    const ins = db.prepare(`INSERT OR REPLACE INTO prices (ticker, date, open, high, low, close, volume, observed_at, origin, provider, adjusted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', 1)`);
    for (const r of priceRows) ins.run(...(r as never[]));

    const file13F = (m: number, period: string, pIdx: number, opts: { amendmentType?: 'RESTATEMENT' | 'NEW HOLDINGS'; acceptedAt: string; rows?: { i: number; shares: number }[] }) => {
      const mgr = DEMO_MANAGERS[m];
      const rows = (opts.rows ?? DEMO_ISSUERS.map((_, i) => ({ i, shares: holdings[m][i][pIdx] })).filter((r) => r.shares > 0)).map((r) => ({
        name: DEMO_ISSUERS[r.i].name.toUpperCase().replace(' (DEMO)', ''),
        cusip: cusipFor(r.i),
        shares: r.shares,
        value: r.shares * closeOn(DEMO_ISSUERS[r.i].ticker, period),
      }));
      // One manager also reports a call-option row, which must be excluded from share counts.
      if (m === 6 && !opts.amendmentType) rows.push({ name: 'QUILLON SEMICONDUCTOR CORP', cusip: cusipFor(T('QSMI')), shares: 2e5, value: 2e5 * closeOn('QSMI', period), putCall: 'Call' } as never);
      const tableXml = infoTableXml(rows);
      const cXml = coverXml({ managerName: mgr.name, period, amendmentType: opts.amendmentType, entries: rows.length, total: rows.reduce((s, r) => s + Math.round(r.value), 0) });
      const accession = acc(mgr.cik, opts.acceptedAt);
      const filingDate = opts.acceptedAt.slice(0, 10);
      const parsed = parse13FInformationTable(tableXml, filingDate);
      const cover = parse13FCover(cXml);
      const issues = [...parsed.warnings, ...validate13F(parsed, cover)];
      storeFiling(db, {
        accession, filerCik: mgr.cik, subjectCik: null, formType: opts.amendmentType ? '13F-HR/A' : '13F-HR', baseForm: '13F-HR', isAmendment: !!opts.amendmentType,
        amendmentType: cover.amendmentType, periodOfReport: cover.periodOfReport, filingDate, acceptedAt: opts.acceptedAt, sourceUrl: null, parserVersion: PARSER_13F_VERSION, origin: 'demo',
      }, cXml + tableXml, () => ({ rows: write13FRows(db, accession, mgr.cik, period, parsed.rows), status: issues.length ? 'partial' : 'parsed', message: issues.join('; ') || undefined }), ['holdings_13f'], anchor);
      filingCount++;
      return accession;
    };

    periods.forEach((period, pIdx) => {
      DEMO_MANAGERS.forEach((_, m) => {
        const acceptedAt = managerFilingTime(m, period);
        if (m === 4 && pIdx === 3) {
          // Copperleaf: original omits QSMI; a NEW HOLDINGS amendment 9 days later adds it.
          file13F(m, period, pIdx, { acceptedAt });
          file13F(m, period, pIdx, { acceptedAt: addDays(acceptedAt, 9), amendmentType: 'NEW HOLDINGS', rows: [{ i: T('QSMI'), shares: 1.6e6 }] });
          return;
        }
        if (m === 1 && pIdx === 2) {
          // Granite Arch: original misreports TSPY shares; a RESTATEMENT 20 days later corrects it.
          const tsp = T('TSPY');
          const orig = holdings[m][tsp][pIdx] || 1e6;
          holdings[m][tsp][pIdx] = orig * 10; // keying error in the original
          file13F(m, period, pIdx, { acceptedAt });
          holdings[m][tsp][pIdx] = orig;
          file13F(m, period, pIdx, { acceptedAt: addDays(acceptedAt, 20), amendmentType: 'RESTATEMENT' });
          return;
        }
        file13F(m, period, pIdx, { acceptedAt });
      });
    });
    if (nextPeriod) {
      earlyFilers.forEach((m, k) => {
        const acceptedAt = at(addDays(anchor, -(2 + k * 2)), 19, 30);
        if (acceptedAt > `${nextPeriod}T23:59:59Z`) file13F(m, nextPeriod, 4, { acceptedAt });
      });
    }

    // ---- Form 4 ------------------------------------------------------------
    const ownerSeq = { n: 0 };
    const people = new Map<string, string>();
    const personCik = (name: string) => people.get(name) ?? (people.set(name, `920000${String(++ownerSeq.n).padStart(4, '0')}`), people.get(name)!);
    const day = (n: number) => addDays(anchor, -n).slice(0, 10);
    const form4 = (ticker: string, owner: string, role: Parameters<typeof form4Xml>[0]['role'], txns: Form4Txn[], lagDays = 1, o: { amendment?: boolean; tenB51?: boolean; acceptedOffsetDays?: number } = {}) => {
      const iss = DEMO_ISSUERS[T(ticker)];
      const ownerCik = personCik(owner);
      const period = txns.map((t) => t.date).sort().at(-1)!;
      const xml = form4Xml({ issuerCik: iss.cik, issuerName: iss.name, ticker, ownerCik, ownerName: owner, role, period, txns, amendment: o.amendment, tenB51: o.tenB51 });
      const f = parseForm4(xml);
      const acceptedAt = at(addDays(`${period}T00:00:00Z`, lagDays + (o.acceptedOffsetDays ?? 0)), 21, 10 + (accSeq % 40));
      if (acceptedAt > anchor) return;
      const accession = acc(ownerCik, acceptedAt);
      upsertEntity(db, { cik: ownerCik, name: owner, kind: 'person', origin: 'demo', now: anchor });
      storeFiling(db, {
        accession, filerCik: ownerCik, subjectCik: iss.cik, formType: o.amendment ? '4/A' : '4', baseForm: '4', isAmendment: !!o.amendment,
        periodOfReport: period, filingDate: acceptedAt.slice(0, 10), acceptedAt, sourceUrl: null, parserVersion: PARSER_FORM4_VERSION, origin: 'demo',
      }, xml, () => ({ rows: writeForm4Rows(db, accession, f), status: f.warnings.length ? 'partial' : 'parsed', message: f.warnings.join('; ') || undefined }), ['insider_transactions'], anchor);
      filingCount++;
    };
    const px = (t: string, d: string) => round2(closeOn(t, d));
    // IBBK insider buying cluster (three insiders, open market).
    form4('IBBK', 'Dana R. Whitfield', { officerTitle: 'Chief Executive Officer', director: true }, [{ date: day(12), code: 'P', ad: 'A', shares: 25000, price: px('IBBK', day(12)), after: 410000 }]);
    form4('IBBK', 'Marcus Oyelaran', { officerTitle: 'Chief Financial Officer' }, [{ date: day(9), code: 'P', ad: 'A', shares: 8000, price: px('IBBK', day(9)), after: 96000 }]);
    form4('IBBK', 'Elena Sokolova', { director: true }, [
      { date: day(4), code: 'P', ad: 'A', shares: 12000, price: px('IBBK', day(4)), after: 52000 },
      { date: day(4), code: 'P', ad: 'A', shares: 3000, price: px('IBBK', day(4)), after: 30000, indirect: true },
    ]);
    // HLMD: awards / exercises / withholding / gift — none of these are open-market buys.
    form4('HLMD', 'Priya Natarajan', { officerTitle: 'President & COO' }, [
      { date: day(20), code: 'A', ad: 'A', shares: 15000, price: null, after: 140000 },
      { date: day(20), code: 'F', ad: 'D', shares: 5200, price: px('HLMD', day(20)), after: 134800 },
    ]);
    form4('HLMD', 'Tomas Lindqvist', { officerTitle: 'Chief Technology Officer' }, [
      { date: day(15), code: 'M', ad: 'A', shares: 20000, price: 61.5, after: 88000 },
      { date: day(15), code: 'M', ad: 'D', shares: 20000, price: 61.5, after: 0, derivative: true },
      { date: day(15), code: 'S', ad: 'D', shares: 20000, price: px('HLMD', day(15)), after: 68000 },
    ]);
    form4('HLMD', 'Grace Ibekwe', { director: true }, [{ date: day(18), code: 'G', ad: 'D', shares: 4000, price: null, after: 21000 }]);
    // HLMD director purchase, later corrected by a 4/A (shares 5,000 → 3,500). Only the amendment counts once accepted.
    const hp = px('HLMD', day(10));
    form4('HLMD', 'Robert Achterberg', { director: true }, [{ date: day(10), code: 'P', ad: 'A', shares: 5000, price: hp, after: 15000 }]);
    form4('HLMD', 'Robert Achterberg', { director: true }, [{ date: day(10), code: 'P', ad: 'A', shares: 3500, price: hp, after: 13500 }], 1, { amendment: true, acceptedOffsetDays: 5 });
    // 10b5-1 plan purchase (excluded from the signal) and sales.
    form4('PCFD', 'Helen Marsh', { officerTitle: 'Chief Executive Officer' }, [{ date: day(14), code: 'P', ad: 'A', shares: 2000, price: px('PCFD', day(14)), after: 61000 }], 1, { tenB51: true });
    form4('SLNR', 'Victor Amaral', { officerTitle: 'Chief Executive Officer', director: true }, [{ date: day(6), code: 'S', ad: 'D', shares: 60000, price: px('SLNR', day(6)), after: 240000 }]);
    form4('SLNR', 'June Park', { officerTitle: 'General Counsel' }, [{ date: day(5), code: 'S', ad: 'D', shares: 9000, price: px('SLNR', day(5)), after: 31000 }]);
    form4('AURS', 'Samuel Okafor', { director: true }, [{ date: day(26), code: 'P', ad: 'A', shares: 4000, price: px('AURS', day(26)), after: 22000 }]);
    form4('CBLM', 'Lucia Ferraro', { officerTitle: 'Chief Executive Officer' }, [{ date: day(2), code: 'P', ad: 'A', shares: 30000, price: px('CBLM', day(2)), after: 330000 }]);
    form4('ORBM', 'Lanternfish Value Fund (Demo)', { tenPct: true }, [{ date: day(33), code: 'P', ad: 'A', shares: 900000, price: px('ORBM', day(33)), after: 41200000 }]);
    form4('VRDR', 'Nadia Kowalczyk', { officerTitle: 'EVP Operations' }, [{ date: day(70), code: 'P', ad: 'A', shares: 1500, price: px('VRDR', day(70)), after: 9000 }]);

    // ---- 8-K / 13D / 13G -----------------------------------------------------
    const header = (ticker: string, form: string, base: string, items: string[], daysAgo: number, eventDaysAgo: number, filerCik?: string, isAmendment = false) => {
      const iss = DEMO_ISSUERS[T(ticker)];
      let acceptedAt = at(day(daysAgo), 21, 30 + (accSeq % 25));
      // Never stamp a demo filing after the seed time.
      if (acceptedAt > anchor) acceptedAt = new Date(Date.parse(anchor) - 20 * 60_000).toISOString();
      const accession = acc(filerCik ?? iss.cik, acceptedAt);
      return { iss, acceptedAt, accession, h: {
        accession, filerCik: filerCik ?? iss.cik, subjectCik: iss.cik, formType: form, baseForm: base, isAmendment, periodOfReport: day(eventDaysAgo), eventDate: day(eventDaysAgo),
        filingDate: acceptedAt.slice(0, 10), acceptedAt, items, sourceUrl: null, origin: 'demo' as const,
      } };
    };
    const eightK = (ticker: string, items: string[], daysAgo: number, isAmendment = false, eventDaysAgo = daysAgo) => {
      const { h } = header(ticker, isAmendment ? '8-K/A' : '8-K', '8-K', items, daysAgo, eventDaysAgo, undefined, isAmendment);
      storeFiling(db, { ...h, parserVersion: 'header@1.0.0' }, JSON.stringify(h), () => ({ rows: 0, status: 'header_only' }), [], anchor);
      filingCount++;
    };
    eightK('RMSE', ['2.02', '9.01'], 1);
    eightK('RMSE', ['5.02'], 1);
    eightK('RMSE', ['2.02', '9.01'], 0, true, 1); // amendment to the earnings 8-K — merged with the original
    eightK('SLNR', ['1.05', '8.01'], 4);
    eightK('ORBM', ['1.01', '9.01'], 8);
    eightK('AURS', ['2.02', '9.01'], 22);
    eightK('CRVT', ['8.01'], 11);
    eightK('TSPY', ['5.07'], 16);
    eightK('AKIN', ['2.01', '9.01'], 3);
    eightK('VRDR', ['7.01'], 45);

    const sched = (ticker: string, filerIdx: number, base: 'SC 13D' | 'SC 13G', daysAgo: number, pct: number, isAmendment: boolean, purpose?: string) => {
      const filer = DEMO_MANAGERS[filerIdx];
      const iss = DEMO_ISSUERS[T(ticker)];
      const { h, accession } = header(ticker, `${base}${isAmendment ? '/A' : ''}`, base, [], daysAgo, daysAgo + 3, filer.cik, isAmendment);
      const xml = schedule13Xml({ issuerCik: iss.cik, percent: pct, shares: Math.round((pct / 100) * iss.sharesOut), eventDate: day(daysAgo + 3), purpose });
      const parsed = parseSchedule13Xml(xml);
      storeFiling(db, { ...h, eventDate: parsed.eventDate, parserVersion: PARSER_SCHEDULE13_VERSION }, xml, () => {
        writeOwnershipDisclosure(db, { accession, issuerCik: iss.cik, filerCik: filer.cik, schedule: base === 'SC 13D' ? '13D' : '13G', percentOfClass: parsed.percentOfClass, shares: parsed.shares, eventDate: parsed.eventDate, purposeExcerpt: parsed.purposeExcerpt });
        return { rows: 1, status: parsed.status };
      }, ['ownership_disclosures'], anchor);
      filingCount++;
    };
    sched('ORBM', 3, 'SC 13D', 41, 8.6, false, 'The Reporting Person intends to engage with the board regarding capital allocation and a potential separation of the broadcast segment.');
    sched('ORBM', 3, 'SC 13D', 6, 10.3, true, 'Amendment: the Reporting Person has delivered a letter nominating two directors.');
    sched('TSPY', 5, 'SC 13G', 19, 5.4, false);
    sched('MRLW', 7, 'SC 13D', 150, 6.1, false, 'Investment purposes; may discuss operational improvements with management.');

    // ---- Fundamentals (fictional) ----------------------------------------
    const fins = db.prepare(`INSERT OR REPLACE INTO fundamentals (issuer_cik, concept, label, unit, period_start, period_end, fiscal_period, value, accession, form, filed, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo')`);
    DEMO_ISSUERS.forEach((iss, i) => {
      const r = rng(5000 + i);
      let rev = iss.sharesOut * iss.px * (0.04 + r() * 0.05);
      periods.forEach((period, k) => {
        rev *= 1 + (r() - 0.4) * 0.08;
        const margin = (r() - 0.15) * 0.25;
        const filed = addDays(`${period}T00:00:00Z`, 35).slice(0, 10);
        const fp = `Q${Math.ceil(Number(period.slice(5, 7)) / 3)}`;
        const acn = `99${iss.cik.slice(-8)}-${period.slice(2, 4)}-9${String(k).padStart(5, '0')}`;
        const start = addDays(`${previousQuarterEnd(period)}T00:00:00Z`, 1).slice(0, 10);
        fins.run(iss.cik, 'Revenues', 'Revenue', 'USD', start, period, fp, Math.round(rev), acn, '10-Q', filed);
        fins.run(iss.cik, 'NetIncomeLoss', 'Net income', 'USD', start, period, fp, Math.round(rev * margin), acn, '10-Q', filed);
        fins.run(iss.cik, 'EarningsPerShareDiluted', 'Diluted EPS', 'USD/shares', start, period, fp, round2((rev * margin) / iss.sharesOut), acn, '10-Q', filed);
        fins.run(iss.cik, 'EntityCommonStockSharesOutstanding', 'Shares outstanding', 'shares', null, filed, fp, iss.sharesOut, acn, '10-Q', filed);
      });
    });

    const run = db.prepare(`INSERT INTO ingestion_log (started_at, finished_at, source, status, filings_seen, filings_new, errors, message) VALUES (?, ?, 'demo-seed', 'completed', ?, ?, 0, ?)`);
    run.run(anchor, anchor, filingCount, filingCount, 'Demo dataset generated through production parsers. All records are fictional.');
    setMeta(db, 'dataset', 'demo');
    setMeta(db, 'demo_anchor', anchor);
    setMeta(db, 'data_version', anchor);
    clear13FCache(db);
    return { anchor, periods, filings: filingCount, prices: priceRows.length };
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
