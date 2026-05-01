import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TestCaseOutcome } from '../lib/testCaseOutcomes';

export interface TestCaseHistoryChartProps {
  history: TestCaseOutcome[];
  // Reference-impl variant. In the default (differential) view, `excluded`
  // outcomes are unscored and plot as gaps. For the reference's own page,
  // `excluded` means the reference itself failed — plot those as 0% so the
  // history reads as pass/fail over time.
  referenceMode?: boolean;
}

interface ChartDatum {
  timestamp: string;
  date: string;
  passPct: number | null;
  outcome: string;
}

export function TestCaseHistoryChart({
  history,
  referenceMode = false,
}: TestCaseHistoryChartProps) {
  const data = useMemo<ChartDatum[]>(() => {
    return [...history]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map((point) => ({
        timestamp: point.timestamp,
        date: formatDate(point.timestamp),
        passPct:
          point.status === 'pass'
            ? 100
            : point.status === 'excluded'
              ? referenceMode
                ? 0
                : null
              : point.status === 'skipped'
                ? null
                : 0,
        outcome: formatOutcome(point.status, referenceMode),
      }));
  }, [history, referenceMode]);

  if (data.length === 0) return null;

  return (
    <div style={{ width: '100%', height: 260 }} data-testid="test-case-history-chart">
      <ResponsiveContainer>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
        >
          <defs>
            <linearGradient id="test-pass-gradient" x1="0" y1="0" x2="0" y2="1">
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
            formatter={(v, _name, item) => {
              const d = item.payload as ChartDatum;
              if (v == null) return [d.outcome, 'Outcome'];
              return [`${Number(v).toFixed(0)}%`, d.outcome];
            }}
            labelFormatter={(label, payload) => {
              const d = payload?.[0]?.payload as ChartDatum | undefined;
              return d ? formatFull(d.timestamp) : label;
            }}
          />
          <Area
            type="stepAfter"
            dataKey="passPct"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="url(#test-pass-gradient)"
            dot={{ r: 3 }}
            connectNulls={false}
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

function formatOutcome(
  status: TestCaseOutcome['status'],
  referenceMode: boolean,
): string {
  if (status === 'pass') return 'Passed';
  if (status === 'fail') return 'Failed';
  if (status === 'error') return 'Errored';
  if (status === 'skipped') return 'Not scored';
  // `excluded` for the reference's own view is a failure — everyone else
  // sees it as an exclusion.
  return referenceMode ? 'Failed' : 'Excluded';
}
