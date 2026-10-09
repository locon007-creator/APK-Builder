import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { Icon, type IconName } from './icons.tsx';
import { IS_PREVIEW, useApi, useOnline } from './api.ts';
import { useSettings } from './settings.tsx';
import { ToastHost } from './components/ui.tsx';
import { date } from './format.ts';
import { HomePage } from './pages/Home.tsx';
import { RadarPage } from './pages/Radar.tsx';
import { ExplorePage } from './pages/Explore.tsx';
import { WatchlistPage } from './pages/Watchlist.tsx';
import { InvestorsPage, InvestorPage } from './pages/Investor.tsx';
import { StocksPage, StockPage } from './pages/Stock.tsx';
import { ComparePage } from './pages/Compare.tsx';
import { FilingPage } from './pages/Filing.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { SearchPage } from './pages/Search.tsx';
import { MorePage } from './pages/More.tsx';
import type { DatasetInfo } from '../shared/types.ts';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/radar', label: 'Radar', icon: 'radar' },
  { to: '/explore', label: 'Explore', icon: 'explore' },
  { to: '/watchlist', label: 'Watchlist', icon: 'bookmark' },
];
const SECONDARY: { to: string; label: string; icon: IconName }[] = [
  { to: '/investors', label: 'Investors', icon: 'users' },
  { to: '/stocks', label: 'Stocks', icon: 'building' },
  { to: '/compare', label: 'Compare', icon: 'compare' },
  { to: '/watchlist?tab=alerts', label: 'Alerts', icon: 'bell' },
  { to: '/settings', label: 'Settings & data', icon: 'settings' },
];

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Home'], [/^\/radar/, 'Opportunity Radar'], [/^\/explore/, 'Explore'], [/^\/watchlist/, 'Watchlist'],
  [/^\/investors\/.+/, 'Investor'], [/^\/investors/, 'Investors'], [/^\/stocks\/.+/, 'Stock'], [/^\/stocks/, 'Stocks'],
  [/^\/compare/, 'Compare'], [/^\/filings/, 'Filing'], [/^\/settings/, 'Settings'], [/^\/search/, 'Search'], [/^\/more/, 'More'],
];

function useScrollMemory() {
  const loc = useLocation();
  const nav = useNavigationType();
  const positions = useRef(new Map<string, number>());
  useEffect(() => {
    const save = () => positions.current.set(loc.key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [loc.key]);
  useLayoutEffect(() => {
    if (nav === 'POP') {
      const y = positions.current.get(loc.key) ?? 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      window.scrollTo(0, 0);
    }
  }, [loc.key, nav]);
  useEffect(() => {
    const t = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'Quarry';
    document.title = `${t} · Quarry Research`;
  }, [loc.pathname]);
}

export function App() {
  useScrollMemory();
  const online = useOnline();
  const { asOf, setAsOf } = useSettings();
  const status = useApi<DatasetInfo & { demoAnchor: string | null }>('/api/status');
  const alerts = useApi<{ alerts: { readAt: string | null }[] }>('/api/alerts');
  const unread = alerts.data?.alerts.filter((a) => !a.readAt).length ?? 0;
  const loc = useLocation();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Quarry home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l5-6 4 4 7-9" /></svg>
          </span>
          Quarry
        </Link>
        {status.data?.isDemo && <span className="badge demo" title="All data in this workspace is fictional">DEMO<span className="long"> DATA</span></span>}
        <span className="spacer" />
        <Link to="/search" className="icon-btn" aria-label="Open search"><Icon name="search" /></Link>
        <Link to="/watchlist?tab=alerts" className="icon-btn" aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`}><Icon name="bell" />{unread > 0 && <span className="dot" />}</Link>
        <Link to="/more" className="icon-btn hide-desktop" aria-label="More: investors, stocks, compare, settings"><Icon name="menu" /></Link>
      </header>

      <nav className="sidenav" aria-label="Primary">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}</NavLink>)}
        <div className="sep" />
        {SECONDARY.map((n) => <NavLink key={n.to} to={n.to}><Icon name={n.icon} />{n.label}</NavLink>)}
      </nav>

      <main id="main" tabIndex={-1}>
        {!online && <div className="banner warn" role="status"><Icon name="wifiOff" size={18} /><span><strong>Offline.</strong> Showing previously loaded information; new filings will not appear until you reconnect.</span></div>}
        {status.data?.isDemo && loc.pathname === '/' && (
          <div className="banner demo" role="note">
            <Icon name="flask" size={18} />
            <span><strong>Demo dataset.</strong> Every company, investor, person, filing and price shown is fictional and generated for demonstration{status.data.demoAnchor ? ` on ${date(status.data.demoAnchor)}` : ''}. Connect SEC EDGAR ingestion to see real disclosures.</span>
          </div>
        )}
        {IS_PREVIEW && loc.pathname === '/' && (
          <div className="banner info" role="note">
            <Icon name="info" size={18} />
            <span><strong>Browser preview.</strong> This copy runs entirely on your device from a snapshot of the demo server. Your watchlist and alert rules are saved in this browser only.</span>
          </div>
        )}
        {asOf && (
          <div className="banner info" role="status">
            <Icon name="history" size={18} />
            <span><strong>Historical view as of {date(asOf)}.</strong> Only filings accepted and prices observed on or before this date are used.</span>
            <button className="btn small" onClick={() => setAsOf(null)}>Return to now</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/radar" element={<RadarPage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/investors" element={<InvestorsPage />} />
          <Route path="/investors/:cik" element={<InvestorPage />} />
          <Route path="/stocks" element={<StocksPage />} />
          <Route path="/stocks/:id" element={<StockPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/filings" element={<FilingPage />} />
          <Route path="/filings/:accession" element={<FilingPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/more" element={<MorePage items={SECONDARY} />} />
          <Route path="*" element={<div className="card state"><h3>Page not found</h3><Link className="link" to="/">Go home</Link></div>} />
        </Routes>
        <p className="footer-note">Quarry is a research tool. It does not provide investment advice, predict prices or execute trades. Rankings order what to research first; they are not forecasts.</p>
      </main>

      <nav className="bottomnav" aria-label="Primary">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={22} />{n.label}</NavLink>)}
      </nav>
      <ToastHost />
    </div>
  );
}
