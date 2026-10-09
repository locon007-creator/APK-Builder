import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import type { AlertRecord, AlertRule, AlertRuleType, WatchItem } from '../../shared/types.ts';
import { EmptyState, ErrorState, Loading, OriginBadge, Sheet, SourceLink, Tabs, toast } from '../components/ui.tsx';
import { Icon } from '../icons.tsx';
import { RULE_LABELS } from '../labels.ts';
import { dateTime } from '../format.ts';

type Tab = 'following' | 'alerts' | 'rules';

export function WatchlistPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'following';
  return (
    <>
      <div className="page-head"><h1>Watchlist</h1><p className="muted">Follow stocks, investors and research categories; get alerts when new disclosures arrive.</p></div>
      <Tabs label="Watchlist sections" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[{ value: 'following', label: 'Following' }, { value: 'alerts', label: 'Alerts' }, { value: 'rules', label: 'Alert rules' }]} />
      <div role="tabpanel">
        {tab === 'following' && <Following />}
        {tab === 'alerts' && <Alerts />}
        {tab === 'rules' && <Rules />}
      </div>
    </>
  );
}

function Following() {
  const { data, error, loading, reload } = useApi<{ items: WatchItem[] }>('/api/watchlist');
  const remove = async (i: WatchItem) => {
    await api.del(`/api/watchlist/${i.kind}/${encodeURIComponent(i.id)}`);
    api.invalidate('/api/home'); api.invalidate('/api/radar'); reload();
    toast(`Removed ${i.label}`);
  };
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const items = data?.items ?? [];
  if (!items.length) {
    return <EmptyState icon="bookmark" title="Nothing followed yet" action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><Link className="btn small" to="/stocks">Browse stocks</Link><Link className="btn small" to="/investors">Browse investors</Link></div>}>Use “Follow” on any stock, investor or Radar category.</EmptyState>;
  }
  const groups: [WatchItem['kind'], string][] = [['stock', 'Stocks'], ['manager', 'Investors'], ['category', 'Research categories']];
  return (
    <div className="stack">
      {groups.map(([kind, title]) => {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} aria-labelledby={`wl-${kind}`}>
            <div className="section-head"><h2 id={`wl-${kind}`}>{title}</h2><span className="subtle">{list.length}</span></div>
            <div className="card"><ul className="list">
              {list.map((i) => (
                <li key={i.id} style={{ display: 'flex', alignItems: 'center' }}>
                  <Link className="row-link" style={{ flex: 1 }} to={kind === 'stock' ? `/stocks/${i.id}` : kind === 'manager' ? `/investors/${i.id}` : `/radar?category=${i.id}`}>
                    <span className="grow"><span className="title">{i.label}</span><span className="meta">Following since {dateTime(i.addedAt)}</span></span>
                  </Link>
                  <button className="icon-btn" onClick={() => remove(i)} aria-label={`Stop following ${i.label}`}><Icon name="trash" size={18} /></button>
                </li>
              ))}
            </ul></div>
          </section>
        );
      })}
    </div>
  );
}

function Alerts() {
  const { data, error, loading, reload } = useApi<{ alerts: AlertRecord[]; delivery: { inApp: boolean; webhook: boolean } }>('/api/alerts');
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: number; skippedDuplicates: number }>('/api/alerts/evaluate');
      toast(r.created ? `${r.created} new alert(s)` : 'No new alerts');
      api.invalidate('/api/alerts'); reload();
    } finally { setBusy(false); }
  };
  const markRead = async (id?: number) => {
    await api.post(id ? `/api/alerts/${id}/read` : '/api/alerts/read-all');
    api.invalidate('/api/alerts'); api.invalidate('/api/home'); reload();
  };
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const alerts = data?.alerts ?? [];
  return (
    <>
      <div className="toolbar">
        <button className="btn small" onClick={check} disabled={busy}><Icon name="refresh" size={16} />{busy ? 'Checking…' : 'Check now'}</button>
        {alerts.some((a) => !a.readAt) && <button className="btn small ghost" onClick={() => markRead()}>Mark all read</button>}
      </div>
      <div className="banner info" role="note"><Icon name="info" size={18} /><span>In-app alerts are always on. External delivery (webhook for email/push relays): <b>{data?.delivery.webhook ? 'configured' : 'not configured'}</b>. Each alert shows the actual delivery outcome per channel.</span></div>
      {!alerts.length ? (
        <EmptyState icon="bell" title="No alerts yet" action={<Link className="btn small" to="/watchlist?tab=rules">Create an alert rule</Link>}>Alerts appear when a rule matches a newly accepted disclosure.</EmptyState>
      ) : (
        <div className="stack">
          {alerts.map((a) => (
            <article key={a.id} className="card card-pad" style={{ borderLeft: a.readAt ? undefined : '4px solid var(--accent)' }} aria-label={`${a.readAt ? '' : 'Unread: '}${a.title}`}>
              <div className="split" style={{ alignItems: 'flex-start' }}>
                <div><h3>{a.title}</h3><p className="muted" style={{ fontSize: '0.9rem' }}>{a.body}</p></div>
                <OriginBadge origin={a.origin} />
              </div>
              <dl className="facts" style={{ marginTop: 10 }}>
                <div><dt>Trigger</dt><dd>{a.triggerEvent}</dd></div>
                <div><dt>Source</dt><dd>{a.source}</dd></div>
                <div><dt>Filing accepted</dt><dd>{dateTime(a.filingAcceptedAt)}</dd></div>
                <div><dt>Detected</dt><dd>{dateTime(a.detectedAt)}</dd></div>
              </dl>
              <div style={{ marginTop: 10 }}>
                <div className="label">Delivery</div>
                <ul className="list" style={{ fontSize: '0.84rem' }}>
                  {a.deliveryStatus.map((d) => (
                    <li key={d.channel} style={{ padding: '4px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`badge ${d.status === 'delivered' || d.status === 'sent' ? 'recently_filed' : d.status === 'failed' ? 'stale' : 'unavailable'}`}>{d.channel === 'in_app' ? 'In-app' : d.channel}: {d.status.replace('_', ' ')}</span>
                      <span className="subtle">{d.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {a.limitations.length > 0 && <p className="subtle" style={{ marginTop: 8 }}>Limitation: {a.limitations.join(' ')}</p>}
              <div className="split" style={{ marginTop: 10 }}>
                <span className="subtle">Rule: {a.ruleName}</span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {a.accession && <Link className="link" to={`/filings/${a.accession}`}>Filing</Link>}
                  <SourceLink url={a.sourceUrl} accession={null} origin={a.origin} />
                  {!a.readAt && <button className="btn small ghost" onClick={() => markRead(a.id)}>Mark read</button>}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

const ITEMS_8K_SHORT: [string, string][] = [['1.01', 'Material agreement'], ['1.03', 'Bankruptcy'], ['1.05', 'Cybersecurity incident'], ['2.01', 'Acquisition/disposition'], ['2.02', 'Earnings'], ['3.01', 'Delisting notice'], ['4.02', 'Non-reliance'], ['5.01', 'Change in control'], ['5.02', 'Officer/director change'], ['8.01', 'Other events']];

function Rules() {
  const rules = useApi<{ rules: AlertRule[] }>('/api/alerts/rules');
  const stocks = useApi<{ stocks: { cik: string; ticker: string | null; name: string }[] }>('/api/stocks');
  const investors = useApi<{ investors: { cik: string; name: string }[] }>('/api/investors');
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);

  const save = async (body: Partial<AlertRule>, id?: number) => {
    try {
      if (id) await api.put(`/api/alerts/rules/${id}`, body);
      else await api.post('/api/alerts/rules', body);
      api.invalidate('/api/alerts'); rules.reload();
      setEditing(null);
      toast(id ? 'Rule updated' : 'Rule created — matching alerts added to your inbox');
    } catch (e) { toast((e as Error).message); }
  };
  const remove = async (r: AlertRule) => {
    if (!window.confirm(`Delete the rule “${r.name}” and its alerts?`)) return;
    await api.del(`/api/alerts/rules/${r.id}`);
    api.invalidate('/api/alerts'); rules.reload();
    toast('Rule deleted');
  };
  const targetLabel = (r: AlertRule) => r.targetKind === 'any' ? 'All tracked' : r.targetKind === 'stock'
    ? (stocks.data?.stocks.find((s) => s.cik === r.targetId)?.ticker ?? r.targetId)
    : (investors.data?.investors.find((i) => i.cik === r.targetId)?.name ?? r.targetId);

  if (rules.loading && !rules.data) return <Loading />;
  if (rules.error && !rules.data) return <ErrorState error={rules.error} onRetry={rules.reload} />;
  return (
    <>
      <div className="toolbar"><button className="btn primary small" onClick={() => setEditing('new')}><Icon name="plus" size={16} />New rule</button></div>
      {!rules.data?.rules.length ? (
        <EmptyState icon="bell" title="No alert rules">Create a rule to be notified of new filings, positions, insider purchases or corporate events. New rules also check the previous 14 days.</EmptyState>
      ) : (
        <div className="card"><ul className="list">
          {rules.data.rules.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, paddingRight: 6 }}>
              <div className="row-link" style={{ flex: 1 }}>
                <span className="grow">
                  <span className="title">{r.name}</span>
                  <span className="meta"><span>{RULE_LABELS[r.type]}</span><span>{targetLabel(r)}</span>{r.threshold != null && <span>threshold {r.type === 'share_change' ? `${Math.round(r.threshold * 100)}%` : `$${r.threshold.toLocaleString('en-US')}`}</span>}{!r.enabled && <span className="badge unavailable">Paused</span>}</span>
                </span>
              </div>
              <button className="icon-btn" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}><Icon name="edit" size={18} /></button>
              <button className="icon-btn" onClick={() => remove(r)} aria-label={`Delete ${r.name}`}><Icon name="trash" size={18} /></button>
            </li>
          ))}
        </ul></div>
      )}
      <Sheet open={editing != null} title={editing === 'new' ? 'New alert rule' : 'Edit alert rule'} onClose={() => setEditing(null)}>
        {editing != null && (
          <RuleForm rule={editing === 'new' ? null : editing} stocks={stocks.data?.stocks ?? []} investors={investors.data?.investors ?? []}
            onSave={(b) => save(b, editing === 'new' ? undefined : editing.id)} />
        )}
      </Sheet>
    </>
  );
}

function RuleForm({ rule, stocks, investors, onSave }: { rule: AlertRule | null; stocks: { cik: string; ticker: string | null; name: string }[]; investors: { cik: string; name: string }[]; onSave: (b: Partial<AlertRule>) => void }) {
  const [type, setType] = useState<AlertRuleType>(rule?.type ?? 'insider_purchase');
  const [name, setName] = useState(rule?.name ?? '');
  const [targetKind, setTargetKind] = useState<AlertRule['targetKind']>(rule?.targetKind ?? 'any');
  const [targetId, setTargetId] = useState(rule?.targetId ?? '');
  const [threshold, setThreshold] = useState(rule?.threshold != null ? String(type === 'share_change' ? rule.threshold * 100 : rule.threshold) : '');
  const [items, setItems] = useState<string[]>(rule?.eventItems ?? []);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const allowsManager = ['new_filing', 'new_position', 'share_change'].includes(type);
  const kinds: AlertRule['targetKind'][] = allowsManager ? ['any', 'stock', 'manager'] : ['any', 'stock'];
  const kind = kinds.includes(targetKind) ? targetKind : 'any';
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      const t = threshold === '' ? null : Number(threshold);
      onSave({
        name: name.trim() || RULE_LABELS[type], type, targetKind: kind, targetId: kind === 'any' ? null : targetId || null,
        threshold: t == null || Number.isNaN(t) ? null : type === 'share_change' ? t / 100 : t, eventItems: type === 'corporate_event' ? items : [], enabled,
      });
    }}>
      <div className="field"><label htmlFor="r-type">Alert when</label>
        <select id="r-type" className="input" value={type} onChange={(e) => setType(e.target.value as AlertRuleType)}>
          {Object.entries(RULE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></div>
      <div className="field"><label htmlFor="r-name">Name</label><input id="r-name" className="input" value={name} placeholder={RULE_LABELS[type]} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
      <div className="field"><label htmlFor="r-tk">Applies to</label>
        <select id="r-tk" className="input" value={kind} onChange={(e) => { setTargetKind(e.target.value as AlertRule['targetKind']); setTargetId(''); }}>
          {kinds.map((k) => <option key={k} value={k}>{k === 'any' ? 'All tracked stocks & investors' : k === 'stock' ? 'A specific stock' : 'A specific investor'}</option>)}
        </select></div>
      {kind !== 'any' && (
        <div className="field"><label htmlFor="r-target">{kind === 'stock' ? 'Stock' : 'Investor'}</label>
          <select id="r-target" className="input" required value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Choose…</option>
            {kind === 'stock' ? stocks.map((s) => <option key={s.cik} value={s.cik}>{s.ticker} · {s.name}</option>) : investors.map((i) => <option key={i.cik} value={i.cik}>{i.name}</option>)}
          </select></div>
      )}
      {(type === 'share_change' || type === 'insider_purchase') && (
        <div className="field"><label htmlFor="r-th">{type === 'share_change' ? 'Minimum share-count change (%)' : 'Minimum purchase value ($)'}</label>
          <input id="r-th" className="input" inputMode="decimal" type="number" min={0} step="any" value={threshold} placeholder={type === 'share_change' ? '25' : '0'} onChange={(e) => setThreshold(e.target.value)} /></div>
      )}
      {type === 'corporate_event' && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">8-K items (none selected = items with relevance ≥ 0.6)</legend>
          {ITEMS_8K_SHORT.map(([code, label]) => (
            <label key={code} className="check"><input type="checkbox" checked={items.includes(code)} onChange={() => setItems((x) => (x.includes(code) ? x.filter((c) => c !== code) : [...x, code]))} />{code} · {label}</label>
          ))}
        </fieldset>
      )}
      <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Rule enabled</label>
      <button type="submit" className="btn primary">{rule ? 'Save changes' : 'Create rule'}</button>
    </form>
  );
}

