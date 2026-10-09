import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../icons.tsx';

export function MorePage({ items }: { items: { to: string; label: string; icon: IconName }[] }) {
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <div className="card"><ul className="list">
        {[...items, { to: '/filings', label: 'All filings', icon: 'file' as IconName }].map((i) => (
          <li key={i.to}><Link className="row-link" to={i.to}><span className="ticker-chip" aria-hidden="true"><Icon name={i.icon} size={18} /></span><span className="grow"><span className="title">{i.label}</span></span><Icon name="chevronRight" size={18} /></Link></li>
        ))}
      </ul></div>
    </>
  );
}
