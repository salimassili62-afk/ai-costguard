import type { GuardEvent, GuardEventHandler, GuardEventName } from './types.js';

/**
 * Small synchronous event emitter used by guarded clients.
 */
export class GuardEventEmitter {
  private readonly handlers = new Map<GuardEventName, Set<GuardEventHandler>>();

  /**
   * Subscribes to a guard event and returns an unsubscribe function.
   */
  on(eventName: GuardEventName, handler: GuardEventHandler): () => void {
    const handlers = this.handlers.get(eventName) ?? new Set<GuardEventHandler>();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);

    return () => {
      this.off(eventName, handler);
    };
  }

  /**
   * Removes one event handler from a guard event.
   */
  off(eventName: GuardEventName, handler: GuardEventHandler): void {
    const handlers = this.handlers.get(eventName);
    if (!handlers) return;

    handlers.delete(handler);
    if (handlers.size === 0) {
      this.handlers.delete(eventName);
    }
  }

  /**
   * Emits an event to all current subscribers.
   */
  emit(event: GuardEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Event handlers are opt-in observability hooks and must not affect the guard decision.
      }
    }
  }
}
