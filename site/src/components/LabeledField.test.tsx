import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabeledField } from './LabeledField';

describe('LabeledField', () => {
  it('renders the label in uppercase styling and the value below', () => {
    render(<LabeledField label="Run">abcdef</LabeledField>);
    const label = screen.getByText('Run');
    const value = screen.getByText('abcdef');
    expect(label.className).toMatch(/labeled-field-label/);
    expect(value.className).toMatch(/labeled-field-value/);
  });

  it('adds the mono class when mono is true and omits it otherwise', () => {
    const { rerender } = render(<LabeledField label="Id" mono>xyz</LabeledField>);
    expect(screen.getByText('xyz').className).toMatch(/\bmono\b/);
    rerender(<LabeledField label="Id">xyz</LabeledField>);
    expect(screen.getByText('xyz').className).not.toMatch(/\bmono\b/);
  });

  it('renders bold by default and applies is-regular when bold=false', () => {
    const { rerender } = render(<LabeledField label="T">bold-value</LabeledField>);
    expect(screen.getByText('bold-value').className).not.toMatch(/is-regular/);
    rerender(
      <LabeledField label="T" bold={false}>
        regular-value
      </LabeledField>,
    );
    expect(screen.getByText('regular-value').className).toMatch(/is-regular/);
  });

  it('accepts composed children (not just strings)', () => {
    render(
      <LabeledField label="Ref">
        <span data-testid="child">hello</span>
      </LabeledField>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
