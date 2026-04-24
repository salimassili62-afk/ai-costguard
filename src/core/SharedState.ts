import { WasteDetector } from '../waste-detection/wasteDetector';
import { HistoryStorage } from '../storage/historyStorage';

/**
 * Centralized state management for AI Execution Firewall
 * Provides singleton access to shared detection state across SDK, CLI, and Proxy
 */
class SharedState {
  private static instance: SharedState;
  private wasteDetector: WasteDetector;
  private historyStorage: HistoryStorage;

  private constructor() {
    this.historyStorage = new HistoryStorage();
    this.wasteDetector = new WasteDetector();
  }

  static getInstance(): SharedState {
    if (!SharedState.instance) {
      SharedState.instance = new SharedState();
    }
    return SharedState.instance;
  }

  getWasteDetector(): WasteDetector {
    return this.wasteDetector;
  }

  getHistoryStorage(): HistoryStorage {
    return this.historyStorage;
  }

  reset(): void {
    this.wasteDetector.destroy();
    this.historyStorage.destroy();
    this.historyStorage = new HistoryStorage();
    this.wasteDetector = new WasteDetector();
  }
}

export const sharedState = SharedState.getInstance();
export { SharedState };
