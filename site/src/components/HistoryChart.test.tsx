import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryChart } from './HistoryChart';
import type { ImplHistoryPoint } from '../repository/types';

interface ChartDatum {
  timestamp: string;
  passPct: number;
}

vi.mock('recharts', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children);

  return {
    Area: () => null,
    AreaChart: ({
      children,
      data,
    }: {
      children?: ReactNode;
      data: ChartDatum[];
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': 'area-chart',
          'data-history-order': data.map((d) => d.timestamp).join('|'),
          'data-pass-rate-order': data.map((d) => d.passPct).join('|'),
        },
        children,
      ),
    CartesianGrid: () => null,
    ResponsiveContainer: passthrough,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

describe('HistoryChart', () => {
  it('plots impl history chronologically left-to-right', () => {
    const history: ImplHistoryPoint[] = [
      point('newest', '2026-04-24T12:00:00Z', 99),
      point('oldest', '2026-04-20T12:00:00Z', 40),
      point('middle', '2026-04-22T12:00:00Z', 60),
    ];

    render(<HistoryChart history={history} />);

    expect(screen.getByTestId('area-chart')).toHaveAttribute(
      'data-history-order',
      [
        '2026-04-20T12:00:00Z',
        '2026-04-22T12:00:00Z',
        '2026-04-24T12:00:00Z',
      ].join('|'),
    );
    expect(screen.getByTestId('area-chart')).toHaveAttribute(
      'data-pass-rate-order',
      '40|60|99',
    );
    expect(history.map((p) => p.runId)).toEqual(['newest', 'oldest', 'middle']);
  });
});

function point(
  runId: string,
  timestamp: string,
  passed: number,
): ImplHistoryPoint {
  return {
    runId,
    timestamp,
    total: 100,
    passed,
    failed: 100 - passed,
    errored: 0,
    falloutAfter: null,
  };
}
