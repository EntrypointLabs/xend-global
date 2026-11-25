import { escapeHtml } from './console-html';
import {
  TREND_DAYS,
  VOLUME_PRODUCTS,
  type ConsoleMetrics,
  type VolumeFigure,
  type VolumeProduct,
} from './console-metrics.service';

const PRODUCT_LABELS: Record<VolumeProduct, string> = {
  send: 'Sends',
  pay: 'Pay payments',
  swap: 'Swaps',
  ramp: 'Naira ramps',
  earn: 'Earn deposits',
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const METRICS_STYLES = `
  .metrics { max-width: 1040px; font-variant-numeric: tabular-nums; }
  .metrics p { margin: 0; }
  .metrics .headline {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 48px;
    align-items: end;
    padding: 8px 0 40px;
  }
  .metrics .label { font-size: 13px; font-weight: 600; }
  .metrics .value {
    font-size: 72px;
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 1.05;
    margin-top: 6px;
  }
  .metrics .secondary .value { font-size: 44px; letter-spacing: -0.025em; }
  .metrics .cents { font-size: 0.45em; color: #6b7280; letter-spacing: 0; }
  .metrics .delta { font-size: 13px; color: #6b7280; margin-top: 8px; }
  .metrics .delta b { color: #0a0a0a; font-weight: 600; }
  .metrics h2 { font-size: 13px; font-weight: 600; margin: 0; }
  .metrics .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 13px;
    color: #6b7280;
    border-top: 1px solid #0a0a0a;
    padding-top: 12px;
  }
  .metrics .section-head h2 { color: #0a0a0a; }
  .metrics .trend { padding-bottom: 40px; }
  .metrics .trend svg {
    display: block;
    width: 100%;
    height: 180px;
    margin-top: 16px;
    border-bottom: 1px solid #e5e5e5;
  }
  .metrics .trend rect { fill: #0a0a0a; }
  .metrics .trend rect.idle { fill: #d4d4d4; }
  .metrics .trend rect:hover { fill: #6b7280; }
  .metrics .axis {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #6b7280;
    padding-top: 6px;
  }
  .metrics table { margin-top: 4px; font-size: 14px; }
  .metrics th, .metrics td {
    border: 0;
    border-bottom: 1px solid #e5e5e5;
    padding: 12px 0 12px 24px;
    text-align: right;
    vertical-align: middle;
  }
  .metrics th {
    background: none;
    font-size: 12px;
    font-weight: 400;
    color: #6b7280;
  }
  .metrics th:first-child, .metrics td:first-child {
    text-align: left;
    padding-left: 0;
    font-weight: 600;
  }
  .metrics th:first-child { font-weight: 400; }
  .metrics .share { width: 32%; }
  .metrics .bar { height: 6px; background: #f1f1f1; }
  .metrics .bar i { display: block; height: 100%; background: #0a0a0a; }
  .metrics tfoot td { color: #6b7280; border-bottom: 0; }
  .metrics tfoot td:first-child { font-weight: 400; }
  .metrics .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 40px;
    margin: 32px 0 0;
    padding-top: 12px;
    border-top: 1px solid #0a0a0a;
    font-size: 13px;
  }
  .metrics .facts div { display: flex; gap: 8px; }
  .metrics .facts dt { color: #6b7280; }
  .metrics .facts dd { margin: 0; font-weight: 600; }
  .metrics .asof { font-size: 12px; color: #6b7280; margin-top: 32px; }
  @media (max-width: 720px) {
    .metrics .headline { grid-template-columns: 1fr; gap: 28px; }
    .metrics .value { font-size: 48px; }
    .metrics .secondary .value { font-size: 36px; }
    .metrics th, .metrics td { padding-left: 12px; }
    .metrics .share, .metrics .count { display: none; }
  }
`;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCount(n: number): string {
  return group(String(n));
}

export function splitUsd(cents: bigint): { whole: string; fraction: string } {
  return {
    whole: `$${group((cents / 100n).toString())}`,
    fraction: (cents % 100n).toString().padStart(2, '0'),
  };
}

export function formatUsd(cents: bigint): string {
  const { whole, fraction } = splitUsd(cents);
  return `${whole}.${fraction}`;
}

/** "2026-11-25" as "25 Nov". */
function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}

function trend(daily: ConsoleMetrics['daily']): string {
  const peak = daily.reduce((max, d) => (d.cents > max ? d.cents : max), 0n);
  const slot = 32;
  const width = slot * daily.length;
  const height = 180;
  const bars = daily
    .map((d, i) => {
      // Scaled in integers; a day with any volume keeps a visible sliver.
      const scaled =
        peak === 0n ? 0 : Number((d.cents * BigInt(height - 8)) / peak);
      const h = d.cents === 0n ? 2 : Math.max(scaled, 3);
      const cls = d.cents === 0n ? ' class="idle"' : '';
      const tip = `${shortDay(d.day)}: ${formatUsd(d.cents)}`;
      return `<rect${cls} x="${i * slot + 4}" y="${height - h}" width="${slot - 8}" height="${h}"><title>${escapeHtml(tip)}</title></rect>`;
    })
    .join('');
  const note =
    peak === 0n
      ? `No volume in the last ${TREND_DAYS} days`
      : `Busiest day ${formatUsd(peak)}`;
  const middle = daily[Math.floor(daily.length / 2)];
  return `<section class="trend">
  <div class="section-head"><h2>Daily volume, last ${TREND_DAYS} days</h2><span>${escapeHtml(note)}</span></div>
  <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Daily volume for the last ${TREND_DAYS} days. ${escapeHtml(note)}.">${bars}</svg>
  <div class="axis"><span>${shortDay(daily[0].day)}</span><span>${shortDay(middle.day)}</span><span>${shortDay(daily[daily.length - 1].day)}</span></div>
</section>`;
}

function productRow(
  label: string,
  figure: VolumeFigure,
  total: bigint,
): string {
  // Tenths of a percent, computed in integers before becoming a CSS width.
  const share =
    total === 0n ? 0 : Number((figure.totalCents * 1000n) / total) / 10;
  return `<tr>
  <td>${escapeHtml(label)}</td>
  <td>${formatUsd(figure.totalCents)}</td>
  <td class="share"><div class="bar"><i style="width:${share}%"></i></div></td>
  <td>${formatUsd(figure.recentCents)}</td>
  <td class="count">${formatCount(figure.count)}</td>
</tr>`;
}

export function renderMetrics(metrics: ConsoleMetrics): string {
  const { volume, users, deposits } = metrics;
  const headline = splitUsd(volume.totalCents);
  const rows = VOLUME_PRODUCTS.map((p) =>
    productRow(PRODUCT_LABELS[p], metrics.products[p], volume.totalCents),
  ).join('');
  const asOf = `${metrics.asOf.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  return `<div class="metrics">
<section class="headline">
  <div>
    <p class="label">Total volume</p>
    <p class="value">${headline.whole}<span class="cents">.${headline.fraction}</span></p>
    <p class="delta"><b>${formatUsd(volume.recentCents)}</b> in the last ${TREND_DAYS} days</p>
  </div>
  <div class="secondary">
    <p class="label">Users</p>
    <p class="value">${formatCount(users.total)}</p>
    <p class="delta"><b>${formatCount(users.recent)}</b> joined in the last ${TREND_DAYS} days</p>
  </div>
</section>
${trend(metrics.daily)}
<section>
  <div class="section-head"><h2>Volume by product</h2></div>
  <table>
    <thead><tr><th>Product</th><th>All time</th><th class="share"></th><th>Last ${TREND_DAYS} days</th><th class="count">Transactions</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td>Deposits from outside, not in the total</td>
      <td>${formatUsd(deposits.totalCents)}</td>
      <td class="share"></td>
      <td>${formatUsd(deposits.recentCents)}</td>
      <td class="count">${formatCount(deposits.count)}</td>
    </tr></tfoot>
  </table>
</section>
<dl class="facts">
  <div><dt>Accounts opened</dt><dd>${formatCount(users.accounts)}</dd></div>
  <div><dt>Active in the last ${TREND_DAYS} days</dt><dd>${formatCount(users.active)}</dd></div>
  <div><dt>Merchants</dt><dd>${formatCount(users.merchants)}</dd></div>
</dl>
<p class="asof">As of ${escapeHtml(asOf)}. Days are counted in UTC.</p>
</div>`;
}
