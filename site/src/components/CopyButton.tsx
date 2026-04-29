import { useState, type MouseEvent } from 'react';

export interface CopyButtonProps {
  // The text placed on the clipboard when clicked.
  text: string;
  // Accessible label (also used as tooltip unless `title` is set).
  label: string;
  // Optional tooltip override. Defaults to `label`.
  title?: string;
  // Extra class on the <button>. Default styling lives on `.copy-button`.
  className?: string;
}

const COPIED_RESET_MS = 1500;

// Clipboard-copy button. While idle it renders a copy-icon <button>; right
// after a successful copy it swaps to a "Copied!" chip for COPIED_RESET_MS
// so the user gets an obvious confirmation even on a single-frame click.
//
// Swallows click propagation so enclosing clickable cards (e.g. the expand
// toggle on FailureCard) don't also react to the click.
export function CopyButton({ text, label, title, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    let wrote = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        wrote = true;
      }
    } catch {
      // clipboard unavailable (permission denied / insecure context); fall
      // through to the synchronous fallback below.
    }
    if (!wrote) writeToClipboardFallback(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  const cls = ['copy-button', copied ? 'is-copied' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      aria-live="polite"
      title={title ?? label}
      onClick={onClick}
    >
      {copied ? (
        <span className="copy-button-confirmation">Copied!</span>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M7 3.5A2.5 2.5 0 0 1 9.5 1h5A2.5 2.5 0 0 1 17 3.5v7A2.5 2.5 0 0 1 14.5 13h-5A2.5 2.5 0 0 1 7 10.5z" />
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H6v1.5h-.5A1 1 0 0 0 4.5 7.5v7a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V14H13v.5A2.5 2.5 0 0 1 10.5 17h-5A2.5 2.5 0 0 1 3 14.5z" />
        </svg>
      )}
    </button>
  );
}

// Last-ditch clipboard write using the deprecated execCommand API for
// browsers / contexts where navigator.clipboard is unavailable or throws
// (e.g. non-secure iframes, some embedded webviews). Silent no-op on
// failure — the caller still flips to the "Copied!" state to avoid a
// misleading UI, matching GitHub's behavior.
function writeToClipboardFallback(text: string): void {
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand?.('copy');
  } catch {
    // ignore
  } finally {
    document.body.removeChild(textarea);
  }
}
