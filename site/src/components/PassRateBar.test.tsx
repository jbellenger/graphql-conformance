import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PassRateBar } from './PassRateBar';

function getFill(container: HTMLElement): HTMLElement {
  return container.querySelector('.bar-fill') as HTMLElement;
}

describe('PassRateBar', () => {
  it('labels itself with the formatted percentage for screen readers', () => {
    render(<PassRateBar passPct={87.2} />);
    expect(screen.getByLabelText('87.2% passing')).toBeInTheDocument();
  });

  it('applies bar-pass tone at ≥95%', () => {
    const { container } = render(<PassRateBar passPct={99.1} />);
    expect(getFill(container).className).toMatch(/bar-pass/);
  });

  it('applies bar-warn tone between 50% and 95%', () => {
    const { container } = render(<PassRateBar passPct={72} />);
    expect(getFill(container).className).toMatch(/bar-warn/);
  });

  it('applies bar-fail tone below 50%', () => {
    const { container } = render(<PassRateBar passPct={12} />);
    expect(getFill(container).className).toMatch(/bar-fail/);
  });

  it('clamps the fill width to [0, 100]%', () => {
    const { container, rerender } = render(<PassRateBar passPct={150} />);
    expect(getFill(container).style.width).toBe('100%');
    rerender(<PassRateBar passPct={-5} />);
    expect(getFill(container).style.width).toBe('0%');
  });

  it('uses the 95/50 thresholds exactly (consistent with the dashboard)', () => {
    const { container, rerender } = render(<PassRateBar passPct={95} />);
    expect(getFill(container).className).toMatch(/bar-pass/);
    rerender(<PassRateBar passPct={94.9} />);
    expect(getFill(container).className).toMatch(/bar-warn/);
    rerender(<PassRateBar passPct={50} />);
    expect(getFill(container).className).toMatch(/bar-warn/);
    rerender(<PassRateBar passPct={49.9} />);
    expect(getFill(container).className).toMatch(/bar-fail/);
  });
});
