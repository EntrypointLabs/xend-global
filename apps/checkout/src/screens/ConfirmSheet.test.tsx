// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfirmSheet } from './ConfirmSheet';
import type { IntentView } from '../lib/api';

const intent = {
  merchantDisplayName: 'Chowderr',
  displayCurrency: 'USD',
  displayAmountMinor: '100',
  usdcSettlementRaw: '1000000',
  expiresAt: '2026-09-20T12:00:00Z',
} as IntentView;

let root: Root;
let container: HTMLDivElement;
function render(content: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(content));
}
function buttonNamed(name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-20T11:59:59Z'));
});

describe('Payment approval controls', () => {
  it('does not label an in-flight approval expired when its deadline passes', () => {
    render(
      <ConfirmSheet
        intent={intent}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        busy
      />,
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(buttonNamed('Confirming').disabled).toBe(true);
    expect(buttonNamed('Cancel').disabled).toBe(true);
    expect(container.textContent).not.toContain('This quote expired');
  });

  it('fails closed when a quote has an invalid deadline', () => {
    render(
      <ConfirmSheet
        intent={{ ...intent, expiresAt: 'invalid' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(buttonNamed('Quote expired').disabled).toBe(true);
  });

  it('disables approval when the pinned quote expires while open', () => {
    const confirm = vi.fn();
    render(
      <ConfirmSheet intent={intent} onConfirm={confirm} onCancel={vi.fn()} />,
    );
    act(() => {
      window.dispatchEvent(new Event('pointermove'));
      vi.advanceTimersByTime(500);
    });
    expect(buttonNamed('Confirm payment').disabled).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(buttonNamed('Quote expired').disabled).toBe(true);
    act(() => buttonNamed('Quote expired').click());
    expect(confirm).not.toHaveBeenCalled();
    expect(buttonNamed('Cancel').disabled).toBe(false);
  });
  it('does not report cancellation while approval is running', () => {
    const cancel = vi.fn();
    render(
      <ConfirmSheet
        intent={intent}
        onConfirm={vi.fn()}
        onCancel={cancel}
        busy
      />,
    );
    const button = buttonNamed('Cancel');
    expect(button.disabled).toBe(true);
    act(() => button.click());
    expect(cancel).not.toHaveBeenCalled();
  });

  it('allows cancellation before approval without arming', () => {
    const cancel = vi.fn();
    render(
      <ConfirmSheet intent={intent} onConfirm={vi.fn()} onCancel={cancel} />,
    );
    act(() => buttonNamed('Cancel').click());
    expect(cancel).toHaveBeenCalledOnce();
    expect(buttonNamed('Confirm payment').disabled).toBe(true);
  });
});
