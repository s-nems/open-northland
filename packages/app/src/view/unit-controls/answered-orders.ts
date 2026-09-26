import { diag } from '../../diag/index.js';

/**
 * A click whose order hangs on the host's answer runs it once the answer lands, and never after the
 * controls are gone. Each click registers one continuation, so a click orders once.
 */
export interface AnsweredOrders {
  after<T>(answer: Promise<T>, then: (value: T) => void): void;
  dispose(): void;
}

export function createAnsweredOrders(): AnsweredOrders {
  let disposed = false;
  return {
    after: (answer, then) => {
      void answer.then(
        (value) => {
          if (!disposed) then(value);
        },
        (error: unknown) =>
          diag.warn('orders', 'a click went unanswered by the host', { error: String(error) }),
      );
    },
    dispose: () => {
      disposed = true;
    },
  };
}
