import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
} from 'recharts';
import type { ImplHistoryPoint } from '../repository/types';
import { computePassPct } from '../lib/passRate';

export interface HistoryChartProps {
  history: ImplHistoryPoint[];
}

interface ChartDatum {
  timestamp: string;
  date: string;
  passPct: number;
  failed: number;
  errored: number;
  total: number;
  falloutAfter: number | null;
}

export function HistoryChart({ history }: HistoryChartProps) {
  const data = useMemo<ChartDatum[]>(() => {
    return history.map((h) => {
      const passPct = computePassPct(h.passed, h.total);
      return {
        timestamp: h.timestamp,
        date: formatDate(h.timestamp),
        passPct,
        failed: h.failed,
        errored: h.errored,
        total: h.total,
        falloutAfter: h.falloutAfter,
      };
    });
  }, [history]);

  if (data.length < 2) return null;

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
        >
          <defs>
            <linearGradient id="pass-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-primary)"
                stopOpacity={0.35}
              />
              <stop
                offset="100%"
                stopColor="var(--color-primary)"
                stopOpacity={0.05}
              />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={12} />
          <YAxis
            domain={[0, 100]}
            stroke="var(--color-text-muted)"
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
            }}
            formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Pass rate']}
            labelFormatter={(label, payload) => {
              const d = payload?.[0]?.payload as ChartDatum | undefined;
              return d ? formatFull(d.timestamp) : label;
            }}
          />
          <Area
            type="monotone"
            dataKey="passPct"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#pass-gradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatDate(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFull(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  return d.toLocaleString();
}
