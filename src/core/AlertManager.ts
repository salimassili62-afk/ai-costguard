import axios from 'axios';
import { ConfigManager } from '../config';
import type { Decision, RiskLevel, Category } from './DetectionEngine';
import { FirewallMetadata } from './types';

export interface FirewallAlert {
  decision: Decision;
  riskLevel: RiskLevel;
  dangerScore: number;
  category: Category;
  reason: string;
  estimatedCost: number;
  metadata?: FirewallMetadata;
}

const RISK_RANK: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class AlertManager {
  private static instance: AlertManager;

  static getInstance(): AlertManager {
    if (!AlertManager.instance) {
      AlertManager.instance = new AlertManager();
    }
    return AlertManager.instance;
  }

  notify(alert: FirewallAlert): void {
    const config = new ConfigManager().alerts;
    if (!config.enabled || config.channels.length === 0) {
      return;
    }

    for (const channel of config.channels) {
      if (channel.enabled === false) continue;
      const minRisk = channel.minRiskLevel || 'MEDIUM';
      if (RISK_RANK[alert.riskLevel] < RISK_RANK[minRisk]) continue;

      const payload = this.formatPayload(alert, channel.type);
      axios.post(channel.url, payload, { timeout: 3000 }).catch(() => {
        // Alerts must never block request-path decisions.
      });
    }
  }

  private formatPayload(alert: FirewallAlert, type: string): Record<string, any> {
    const text = `AIFW ${alert.decision.toUpperCase()}: ${alert.reason} ($${alert.estimatedCost.toFixed(4)}, score ${alert.dangerScore})`;

    if (type === 'slack') {
      return { text, aifw: alert };
    }

    if (type === 'pagerduty') {
      return {
        routing_key: '',
        event_action: 'trigger',
        payload: {
          summary: text,
          severity: alert.riskLevel === 'CRITICAL' ? 'critical' : 'warning',
          source: 'ai-execution-firewall',
          custom_details: alert,
        },
      };
    }

    return {
      text,
      alert,
    };
  }
}

export const alertManager = AlertManager.getInstance();
