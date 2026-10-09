import { type DB, all } from '../db/index.ts';
import type { AlertRecord, AlertRule, AlertRuleType, DataOrigin } from '../../shared/types.ts';
import { computeManagerChanges, periodsForManager, trackedManagers } from './thirteenF.ts';
import { listEvents, listInsiderTransactions } from './queries.ts';
import { isQualifyingOpenMarketPurchase } from './form4Codes.ts';
import { eventRelevance } from './events8k.ts';
import { dedupeEvents } from './radar.ts';
import { addDays } from './asof.ts';

/** New rules look back this far so a just-created rule shows recent matches. */
export const ALERT_LOOKBACK_DAYS = 14;

export const RULE_TYPE_LABELS: Record<AlertRuleType, string> = {
  new_filing: 'Newly accepted filing',
  new_position: 'New reported 13F position',
  share_change: 'Material 13F share-count change',
  insider_purchase: 'Qualifying insider open-market purchase',
  ownership_disclosure: 'Schedule 13D / 13G disclosure',
  corporate_event: 'Selected 8-K corporate event',
};

export interface DeliveryAdapter {
  channel: string;
  configured: boolean;
  deliver(alert: { title: string; body: string; sourceUrl: string | null; accession: string | null }): Promise<{ status: 'sent' | 'failed' | 'not_configured'; detail: string }>;
}

export function webhookAdapter(url: string, fetchImpl: typeof fetch = fetch): DeliveryAdapter {
  return {
    channel: 'webhook',
    configured: !!url,
    async deliver(a) {
      if (!url) return { status: 'not_configured', detail: 'ALERT_WEBHOOK_URL not set; external delivery skipped.' };
      try {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
        // Only a 2xx acknowledgement from the receiver counts as delivered.
        return res.ok ? { status: 'sent', detail: `Receiver acknowledged with HTTP ${res.status}.` } : { status: 'failed', detail: `Receiver returned HTTP ${res.status}.` };
      } catch (err) {
        return { status: 'failed', detail: `Network error: ${(err as Error).message}` };
      }
    },
  };
}

interface RuleRow {
  id: number; workspace_id: string; name: string; type: AlertRuleType; target_kind: 'stock' | 'manager' | 'any'; target_id: string | null;
  threshold: number | null; event_items: string | null; enabled: number; created_at: string; updated_at: string;
}

export function toRule(r: RuleRow): AlertRule {
  return {
    id: r.id, name: r.name, type: r.type, targetKind: r.target_kind, targetId: r.target_id, threshold: r.threshold,
    eventItems: (r.event_items ?? '').split(',').filter(Boolean), enabled: !!r.enabled, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

interface Candidate {
  dedupeKey: string; title: string; body: string; triggerEvent: string; source: string; accession: string | null;
  sourceUrl: string | null; filingAcceptedAt: string | null; limitations: string[]; origin: DataOrigin;
}

/** Produce the alert candidates a rule matches as of `now` (pure: no writes). */
export function matchRule(db: DB, rule: AlertRule, now: string): Candidate[] {
  const since = addDays(rule.createdAt < now ? rule.createdAt : now, -ALERT_LOOKBACK_DAYS);
  const out: Candidate[] = [];
  const stock = rule.targetKind === 'stock' ? rule.targetId : null;
  const manager = rule.targetKind === 'manager' ? rule.targetId : null;

  if (rule.type === 'new_filing') {
    const where = ['f.accepted_at > ?', 'f.accepted_at <= ?'];
    const params: unknown[] = [since, now];
    if (stock) { where.push('f.subject_cik = ?'); params.push(stock); }
    if (manager) { where.push('f.filer_cik = ?'); params.push(manager); }
    const rows = all<{ accession: string; form_type: string; base_form: string; filer_cik: string; subject_cik: string | null; period_of_report: string | null; accepted_at: string; source_url: string | null; origin: DataOrigin; fname: string | null; sname: string | null }>(
      db, `SELECT f.*, fe.name AS fname, se.name AS sname FROM filings f LEFT JOIN entities fe ON fe.cik = f.filer_cik LEFT JOIN entities se ON se.cik = f.subject_cik
           WHERE ${where.join(' AND ')} ORDER BY f.accepted_at`, ...params);
    for (const r of rows) {
      out.push({
        // Amendments for the same filer/subject/period collapse onto the original notification.
        dedupeKey: `filing|${r.base_form}|${r.filer_cik}|${r.subject_cik ?? ''}|${r.period_of_report ?? r.accession}`,
        title: `${r.form_type} accepted: ${r.sname ?? r.fname ?? r.filer_cik}`,
        body: `${r.fname ?? r.filer_cik} filed ${r.form_type}${r.period_of_report ? ` for period ${r.period_of_report}` : ''}.`,
        triggerEvent: 'Filing accepted by EDGAR', source: `SEC EDGAR ${r.form_type}`, accession: r.accession, sourceUrl: r.source_url,
        filingAcceptedAt: r.accepted_at, limitations: r.base_form === '13F-HR' ? ['A newly filed 13F describes quarter-end holdings, not recent trades.'] : [], origin: r.origin,
      });
    }
  }

  if (rule.type === 'new_position' || rule.type === 'share_change') {
    const threshold = rule.threshold ?? 0.25;
    const managers = manager ? trackedManagers(db).filter((m) => m.cik === manager) : trackedManagers(db);
    for (const m of managers) {
      for (const period of periodsForManager(db, m.cik, now).slice(0, 2)) {
        const mc = computeManagerChanges(db, m.cik, m.name, period, now);
        if (!mc || !mc.prior || mc.current.acceptedAt <= since) continue;
        for (const c of mc.changes) {
          if (stock && c.issuerCik !== stock) continue;
          const isNew = c.kind === 'new';
          const material = c.kind === 'exited' || isNew || (c.shareChangePct != null && Math.abs(c.shareChangePct) >= threshold);
          if (rule.type === 'new_position' ? !isNew : !material || c.kind === 'unchanged') continue;
          out.push({
            dedupeKey: `13f|${rule.type}|${m.cik}|${c.cusip}|${period}`,
            title: `${m.name}: ${c.kind} ${c.ticker ?? c.issuerName}`,
            body: `Reported shares ${c.sharesPrior.toLocaleString('en-US')} → ${c.sharesCurrent.toLocaleString('en-US')} (${c.priorPeriod} → ${period}).`,
            triggerEvent: rule.type === 'new_position' ? 'New reported position' : `Share-count change ≥ ${(threshold * 100).toFixed(0)}%`,
            source: '13F-HR', accession: c.filingAccession, sourceUrl: null, filingAcceptedAt: c.filingAcceptedAt,
            limitations: ['13F reflects quarter-end holdings; trade dates and prices are not disclosed.'], origin: c.origin,
          });
        }
      }
    }
  }

  if (rule.type === 'insider_purchase') {
    const minValue = rule.threshold ?? 0;
    for (const t of listInsiderTransactions(db, { asOf: now, issuerCik: stock ?? undefined })) {
      if (t.acceptedAt <= since || !isQualifyingOpenMarketPurchase(t) || (t.value ?? 0) < minValue) continue;
      out.push({
        dedupeKey: `p|${t.issuerCik}|${t.ownerCik}|${t.transactionDate}|${t.shares}|${t.price}`,
        title: `Insider purchase: ${t.ticker ?? t.issuerName}`,
        body: `${t.ownerName} (${t.ownerRole}) bought ${t.shares.toLocaleString('en-US')} shares at $${t.price?.toFixed(2)} on ${t.transactionDate}.`,
        triggerEvent: 'Form 4 code P (open-market purchase)', source: 'Form 4', accession: t.accession, sourceUrl: t.sourceUrl,
        filingAcceptedAt: t.acceptedAt, limitations: ['Insider purchases are not necessarily predictive.'], origin: t.origin,
      });
    }
  }

  if (rule.type === 'ownership_disclosure' || rule.type === 'corporate_event') {
    const forms = rule.type === 'ownership_disclosure' ? (['SC 13D', 'SC 13G'] as const) : (['8-K'] as const);
    let events = listEvents(db, { asOf: now, issuerCik: stock ?? undefined, forms: [...forms] }).filter((e) => e.acceptedAt > since);
    if (rule.type === 'corporate_event') {
      events = dedupeEvents(events).filter((e) => (rule.eventItems.length ? e.items.some((i) => rule.eventItems.includes(i.code)) : eventRelevance(e.items.map((i) => i.code)) >= 0.6));
    }
    for (const e of events) {
      out.push({
        dedupeKey: rule.type === 'corporate_event'
          ? `8k|${e.issuerCik}|${e.eventDate ?? ''}|${e.items.map((i) => i.code).sort().join(',')}`
          : `own|${e.accession}`,
        title: `${e.formType}: ${e.ticker ?? e.issuerName}`,
        body: e.headline,
        triggerEvent: rule.type === 'corporate_event' ? `8-K items ${e.items.map((i) => i.code).join(', ')}` : `${e.formType} filed`,
        source: e.formType, accession: e.accession, sourceUrl: e.sourceUrl, filingAcceptedAt: e.acceptedAt,
        limitations: rule.type === 'ownership_disclosure' ? ['Schedule 13D/13G stakes are as of the event date, not necessarily current.'] : [], origin: e.origin,
      });
    }
  }
  return out;
}

/**
 * Evaluate enabled rules and persist new alerts. Re-running (or re-ingesting the
 * same filings, or receiving amendments that map to the same key) never creates a
 * duplicate: (workspace, rule, dedupe_key) is unique.
 */
export async function evaluateAlerts(db: DB, opts: { now: string; workspaceId?: string; adapters: DeliveryAdapter[] }): Promise<{ created: number; skippedDuplicates: number }> {
  const rules = all<RuleRow>(db, `SELECT * FROM alert_rules WHERE enabled = 1 ${opts.workspaceId ? 'AND workspace_id = ?' : ''}`, ...(opts.workspaceId ? [opts.workspaceId] : []));
  let created = 0;
  let skipped = 0;
  const insert = db.prepare(`INSERT INTO alerts (workspace_id, rule_id, dedupe_key, title, body, trigger_event, source, accession, source_url, filing_accepted_at,
      detected_at, delivery, limitations, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id, rule_id, dedupe_key) DO NOTHING`);
  for (const row of rules) {
    const seen = new Set<string>();
    for (const c of matchRule(db, toRule(row), opts.now)) {
      if (seen.has(c.dedupeKey)) { skipped++; continue; }
      seen.add(c.dedupeKey);
      const delivery = [{ channel: 'in_app', status: 'delivered', detail: 'Stored in the in-app alert inbox.' }];
      const res = insert.run(row.workspace_id, row.id, c.dedupeKey, c.title, c.body, c.triggerEvent, c.source, c.accession, c.sourceUrl, c.filingAcceptedAt,
        opts.now, JSON.stringify(delivery), JSON.stringify(c.limitations), c.origin);
      if (Number(res.changes) === 0) { skipped++; continue; }
      created++;
      const id = Number(res.lastInsertRowid);
      for (const a of opts.adapters) {
        const r = a.configured ? await a.deliver(c) : { status: 'not_configured' as const, detail: `${a.channel} delivery not configured.` };
        delivery.push({ channel: a.channel, status: r.status, detail: r.detail });
      }
      db.prepare('UPDATE alerts SET delivery = ? WHERE id = ?').run(JSON.stringify(delivery), id);
    }
  }
  return { created, skippedDuplicates: skipped };
}

export function listAlerts(db: DB, workspaceId: string, limit = 100): AlertRecord[] {
  return all<{ id: number; rule_id: number; rule_name: string; title: string; body: string; trigger_event: string; source: string; accession: string | null; source_url: string | null; filing_accepted_at: string | null; detected_at: string; delivery: string; limitations: string; read_at: string | null; origin: DataOrigin }>(
    db, `SELECT a.*, r.name AS rule_name FROM alerts a JOIN alert_rules r ON r.id = a.rule_id WHERE a.workspace_id = ? ORDER BY a.detected_at DESC, a.filing_accepted_at DESC LIMIT ?`, workspaceId, limit,
  ).map((a) => ({
    id: a.id, ruleId: a.rule_id, ruleName: a.rule_name, title: a.title, body: a.body, triggerEvent: a.trigger_event, source: a.source,
    accession: a.accession, sourceUrl: a.source_url, filingAcceptedAt: a.filing_accepted_at, detectedAt: a.detected_at,
    deliveryStatus: JSON.parse(a.delivery), limitations: JSON.parse(a.limitations), readAt: a.read_at, origin: a.origin,
  }));
}
