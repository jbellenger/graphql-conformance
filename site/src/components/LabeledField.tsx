import type { ReactNode } from 'react';

export interface LabeledFieldProps {
  // Small uppercase label rendered above the value (e.g. "Test Case").
  label: string;
  // The value to render — usually a string/testId but accepts arbitrary
  // children for links, pills, or composed content.
  children: ReactNode;
  // Render the value with the monospace font treatment. Use for opaque ids
  // (test case ids, run uuids) where prose proportional font feels wrong.
  mono?: boolean;
  // Give the value a bold weight. Default true — most LabeledField uses
  // emphasise an id or name. Pass false for prose values (e.g. timestamps)
  // where bold feels off.
  bold?: boolean;
}

// Small "LABEL / value" stacked field. Used by FailureCard (one block for
// the test id) and by the FailureDetail top card (one block per data item)
// so the two surfaces share identical visual treatment.
export function LabeledField({
  label,
  children,
  mono = false,
  bold = true,
}: LabeledFieldProps) {
  const classes = [
    'labeled-field-value',
    mono ? 'mono' : '',
    bold ? '' : 'is-regular',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="labeled-field">
      <div className="labeled-field-label">{label}</div>
      <div className={classes}>{children}</div>
    </div>
  );
}
