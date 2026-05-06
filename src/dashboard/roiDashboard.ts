import { DemoResult } from '../demo/demoRunner';

export interface RoiDashboard {
  total_requests: number;
  blocked_requests: number;
  cost_before_firewall: number;
  cost_after_firewall: number;
  total_cost_saved_usd: number;
  efficiency_percentage: number;
}

export function toRoiDashboard(result: DemoResult): RoiDashboard {
  const efficiency =
    result.costBeforeFirewall === 0 ? 0 : (result.totalCostSavedUsd / result.costBeforeFirewall) * 100;
  return {
    total_requests: result.totalRequests,
    blocked_requests: result.blockedRequests,
    cost_before_firewall: Number(result.costBeforeFirewall.toFixed(6)),
    cost_after_firewall: Number(result.costAfterFirewall.toFixed(6)),
    total_cost_saved_usd: Number(result.totalCostSavedUsd.toFixed(6)),
    efficiency_percentage: Number(efficiency.toFixed(2)),
  };
}

export function formatRoiDashboardHuman(dashboard: RoiDashboard): string {
  return [
    'ROI DASHBOARD',
    '=============',
    `total_requests: ${dashboard.total_requests}`,
    `blocked_requests: ${dashboard.blocked_requests}`,
    `cost_before_firewall: $${dashboard.cost_before_firewall.toFixed(2)}`,
    `cost_after_firewall:  $${dashboard.cost_after_firewall.toFixed(2)}`,
    `total_cost_saved_usd: $${dashboard.total_cost_saved_usd.toFixed(2)}`,
    `efficiency_percentage: ${dashboard.efficiency_percentage.toFixed(2)}%`,
  ].join('\n');
}
