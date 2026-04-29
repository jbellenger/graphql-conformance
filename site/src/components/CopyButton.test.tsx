import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyButton } from './CopyButton';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// jsdom doesn't ship navigator.clipboard by default. Install a mock with a
// tracked writeText implementation; return the spy for the test to assert on.
function installClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

function uninstallClipboard() {
  Reflect.deleteProperty(navigator, 'clipboard');
}

describe('CopyButton', () => {
  it('writes the provided text to the clipboard when clicked', async () => {
    const writeText = installClipboard();
    render(<CopyButton text="hello" label="Copy hello" />);
    fireEvent.click(screen.getByRole('button', { name: /copy hello/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith('hello');
    });
  });

  it('shows "Copied!" after a successful click (replacing the icon)', async () => {
    installClipboard();
    render(<CopyButton text="x" label="Copy x" />);
    const button = screen.getByRole('button', { name: /copy x/i });

    // Icon is visible before click.
    expect(button.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('Copied!')).toBeNull();

    fireEvent.click(button);

    // After state flushes, "Copied!" replaces the icon.
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(button.querySelector('svg')).toBeNull();
    expect(button.className).toMatch(/is-copied/);
  });

  it('reverts from "Copied!" back to the icon after the reset timeout', async () => {
    installClipboard();
    vi.useFakeTimers();
    render(<CopyButton text="x" label="Copy x" />);
    const button = screen.getByRole('button', { name: /copy x/i });
    fireEvent.click(button);

    // Flush the click handler's microtasks synchronously under fake timers.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Copied!')).toBeInTheDocument();

    // Advance past the 1.5s reset; the icon comes back.
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.queryByText('Copied!')).toBeNull();
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('falls back to execCommand when navigator.clipboard is absent', async () => {
    uninstallClipboard();
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
    });

    render(<CopyButton text="fallback-text" label="Copy fallback" />);
    fireEvent.click(screen.getByRole('button', { name: /copy fallback/i }));

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith('copy');
    });
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('swallows click propagation so parent clickables do not toggle', () => {
    installClipboard();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyButton text="abc" label="Copy abc" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /copy abc/i }));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
