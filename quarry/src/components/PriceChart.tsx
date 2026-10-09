import type { PriceBar } from '../../shared/types.ts';
import { date } from '../format.ts';

/** Accessible SVG close-price line with volume bars and optional event markers. */
export function PriceChart({ bars, markers = [], label, isDemo }: { bars: PriceBar[]; markers?: { date: string; label: string }[]; label: string; isDemo: boolean }) {
  if (bars.length < 2) return null;
  const W = 360, H = 190, padL = 4, padR = 38, padT = 8, volH = 30, padB = 18;
  const closes = bars.map((b) => b.close);
  const min = Math.min(...closes), max = Math.max(...closes);
  const span = max - min || 1;
  const maxVol = Math.max(...bars.map((b) => b.volume)) || 1;
  const x = (i: number) => padL + (i / (bars.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB - volH - 6);
  const line = bars.map((b, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join('');
  const area = `${line}L${x(bars.length - 1)},${H - padB - volH - 6}L${x(0)},${H - padB - volH - 6}Z`;
  const ticks = [min, min + span / 2, max];
  const first = bars[0], last = bars[bars.length - 1];
  const change = last.close / first.close - 1;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${isDemo ? 'simulated ' : ''}closing price from ${date(first.date)} (${first.close.toFixed(2)}) to ${date(last.date)} (${last.close.toFixed(2)}), ${(change * 100).toFixed(1)}% change.`}>
        <defs>
          <linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity="0.22" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient>
        </defs>
        {ticks.map((t) => <g key={t}><line className="grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} /><text className="axis" x={W - padR + 6} y={y(t) + 3}>{t.toFixed(t >= 100 ? 0 : 2)}</text></g>)}
        {bars.map((b, i) => { const h = (b.volume / maxVol) * volH; return <rect key={b.date} className="vol" x={x(i) - 0.8} y={H - padB - h} width={Math.max(1, (W - padL - padR) / bars.length - 0.5)} height={h} />; })}
        <path d={area} fill="url(#pc-fill)" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.8} />
        {markers.map((m) => {
          const i = bars.findIndex((b) => b.date >= m.date);
          if (i < 0) return null;
          return <g key={m.date + m.label}><line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--accent)" strokeDasharray="3 3" /><circle className="mark" cx={x(i)} cy={y(bars[i].close)} r={4}><title>{`${date(m.date)}: ${m.label}`}</title></circle></g>;
        })}
        <text className="axis" x={padL} y={H - 4}>{date(first.date)}</text>
        <text className="axis" x={W - padR} y={H - 4} textAnchor="end">{date(last.date)}</text>
      </svg>
      <figcaption className="subtle">{isDemo ? 'Simulated demo prices — not market observations.' : 'Daily closes, corporate-action adjusted.'} Dashed markers: filing events.</figcaption>
    </figure>
  );
}
