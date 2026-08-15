// tripTypeBreakdownChart.js
'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Two categorical pairs, so two hues each — taken from the same validated set
// the year lines use, picked so the two bars in a group stay distinct for
// colour-blind readers (worst pair CVD ΔE well clear of the target) and each
// clears 3:1 on the white panel.
const COLORS = {
  classic: '#006fa9',
  electric: '#a07a0c',
  member: '#00633c',
  casual: '#ff35de'
};

const fmt = (n) => n.toLocaleString();

function BreakdownTooltip({ active, payload, label, keys }) {
  if (!active || !payload || !payload.length) return null;
  const total = keys.reduce((sum, k) => sum + (payload.find(p => p.dataKey === k.key)?.value || 0), 0);
  return (
    <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg font-sans" style={{ zIndex: 9999 }}>
      <p className="font-semibold text-gray-800 text-sm mb-2">{label}</p>
      {keys.map(k => {
        const value = payload.find(p => p.dataKey === k.key)?.value || 0;
        const share = total > 0 ? Math.round((value / total) * 100) : 0;
        return (
          <p key={k.key} className="text-sm" style={{ color: COLORS[k.key] }}>
            <span className="font-semibold">{k.label}:</span>
            <span className="ml-2 text-gray-800">{fmt(value)}</span>
            <span className="ml-2 text-gray-500">({share}%)</span>
          </p>
        );
      })}
      <p className="text-sm mt-1 pt-1 border-t border-gray-200 text-gray-600">
        Total: <span className="font-semibold">{fmt(total)}</span>
      </p>
    </div>
  );
}

function GroupedMonthlyChart({ data, keys, note }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--ink-3)' }}>
        No data available for this breakdown.
      </div>
    );
  }

  // Aim for ~14 x-axis labels regardless of how many months are in range.
  const interval = Math.max(0, Math.floor(data.length / 14));

  return (
    <div>
      <ResponsiveContainer width="100%" height={380}>
        <BarChart data={data} margin={{ top: 10, right: 20, left: 20, bottom: 60 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            angle={-45}
            textAnchor="end"
            height={70}
            interval={interval}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
            label={{ value: 'Trips per month', angle: -90, position: 'insideLeft', offset: 0, style: { textAnchor: 'middle' } }}
          />
          <Tooltip content={<BreakdownTooltip keys={keys} />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Legend verticalAlign="top" height={30} />
          {keys.map(k => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.label}
              fill={COLORS[k.key]}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {note && (
        <p className="text-xs mt-2 px-4" style={{ color: 'var(--ink-3)' }}>{note}</p>
      )}
    </div>
  );
}

export default function TripTypeBreakdownChart({ breakdown }) {
  const bikeType = breakdown?.bikeType || [];
  const userType = breakdown?.userType || [];

  return (
    <div className="p-4 space-y-10">
      <section>
        <h3 className="dd-title text-lg mb-1" style={{ color: 'var(--ink)' }}>
          E-bike vs classic, by month
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--ink-2)' }}>
          Bike model is recorded from January 2024, so this comparison starts there.
        </p>
        <GroupedMonthlyChart
          data={bikeType}
          keys={[{ key: 'classic', label: 'Classic' }, { key: 'electric', label: 'E-bike' }]}
        />
      </section>

      <section>
        <h3 className="dd-title text-lg mb-1" style={{ color: 'var(--ink)' }}>
          Member vs casual, by month
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--ink-2)' }}>
          Recorded since 2016.
        </p>
        <GroupedMonthlyChart
          data={userType}
          keys={[{ key: 'member', label: 'Member' }, { key: 'casual', label: 'Casual' }]}
          note={'October 2021 to December 2023 is not shown. The City’s rider type data is not accurate over that period.'}
        />
      </section>

      <p className="text-xs px-4 pb-2" style={{ color: 'var(--ink-3)' }}>
        Only whole months are shown. Trip-type splits come from the City&rsquo;s
        published ridership files and end with that data. The live feed covering
        later days reports totals only.
      </p>
    </div>
  );
}
