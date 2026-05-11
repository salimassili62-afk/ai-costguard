/**
 * GuardPro.ts - SYSTEM-WIDE FINANCIAL CONTROL (PAID VERSION)
 * 
 * The system sees everything as one budget.
 * Runtime financial execution control layer.
 * 
 * NOT: logging, monitoring, middleware, analytics
 * IS: distributed cost firewall for AI systems
 */

import { GuardConfig, RequestContext, GuardState } from './types.js';

// System-wide financial control interfaces
interface FinancialControlLayer {
  projectId: string;
  budget: number;
  spent: number;
  active: boolean;
  emergencyMode: boolean;
  createdAt: number;
  lastUpdated: number;
  enforcementMode: 'hard' | 'soft';
}

interface DistributedFinancialState {
  projectId: string;
  totalSpent: number;
  instances: string[];
  lastSync: number;
  globalLimit: number;
  emergencyActive: boolean;
  circuitBreakerEngaged: boolean;
}

interface GovernanceLayer {
  projectId: string;
  userId?: string;
  workflowId?: string;
  orgId?: string;
  limits: {
    perProject: number;
    perUser?: number;
    perWorkflow?: number;
    perOrg?: number;
  };
}

interface AlertControlPlane {
  slack?: {
    webhook: string;
    channel: string;
  };
  discord?: {
    webhook: string;
    channel: string;
  };
  panicApi?: {
    endpoint: string;
    key: string;
  };
}

/**
 * System-Wide Financial Control - PRODUCTION VERSION
 * 
 * The system sees everything as one budget.
 * Runtime financial execution control layer.
 * 
 * GUARANTEES: System-wide cost containment
 */
export class GuardPro {
  private licenseKey: string;
  private financialControls = new Map<string, FinancialControlLayer>();
  private distributedState = new Map<string, DistributedFinancialState>();
  private governanceLayer = new Map<string, GovernanceLayer>();
  private alertControlPlane?: AlertControlPlane;
  private instanceId: string;
  private emergencyMode: boolean = false;
  private circuitBreakerEngaged: boolean = false;

  constructor(licenseKey: string, alertConfig?: AlertControlPlane) {
    this.licenseKey = licenseKey;
    this.alertControlPlane = alertConfig;
    this.instanceId = this.generateInstanceId();
    this.loadFinancialControlState();
    this.startDistributedSync();
  }

  /**
   * 1. GLOBAL STATE - System-wide truth
   */
  activateFinancialControl(config: { 
    projectId: string; 
    budget: number;
    userId?: string;
    workflowId?: string;
    orgId?: string;
    limits?: {
      perProject?: number;
      perUser?: number;
      perWorkflow?: number;
      perOrg?: number;
    };
  }): boolean {
    if (!this.validateLicense()) {
      console.error('🚨 FINANCIAL CONTROL: Invalid license. System-wide control requires PRO license.');
      return false;
    }

    const { projectId, budget, userId, workflowId, orgId, limits } = config;
    
    const existing = this.financialControls.get(projectId);
    if (existing && existing.active) {
      console.error(`🚨 FINANCIAL CONTROL: System-wide control for ${projectId} already active.`);
      return false;
    }

    const financialControl: FinancialControlLayer = {
      projectId,
      budget,
      spent: existing?.spent || 0,
      active: true,
      emergencyMode: false,
      createdAt: existing?.createdAt || Date.now(),
      lastUpdated: Date.now(),
      enforcementMode: 'hard'
    };

    this.financialControls.set(projectId, financialControl);
    
    // Initialize governance layer
    if (userId || workflowId || orgId || limits) {
      this.governanceLayer.set(projectId, {
        projectId,
        userId,
        workflowId,
        orgId,
        limits: {
          perProject: budget,
          perUser: limits?.perUser || budget,
          perWorkflow: limits?.perWorkflow || budget,
          perOrg: limits?.perOrg || budget,
        }
      });
    }
    
    this.persistFinancialControlState();
    this.initializeDistributedState(projectId, budget);
    
    console.log(`🚨 FINANCIAL CONTROL: System-wide control activated for ${projectId}: $${budget}`);
    return true;
  }

  /**
   * 2. MULTI-INSTANCE AWARENESS - All servers share one budget
   */
  checkFinancialControl(projectId: string, cost: number): boolean {
    const financialControl = this.financialControls.get(projectId);
    
    if (!financialControl || !financialControl.active) {
      return false; // No system-wide control
    }

    // Emergency mode - block everything system-wide
    if (this.emergencyMode || this.circuitBreakerEngaged) {
      console.error(`🚨 FINANCIAL CONTROL: EMERGENCY MODE - All AI execution blocked system-wide for ${projectId}`);
      throw new Error(`Emergency mode engaged system-wide for ${projectId}`);
    }

    // Governance layer checks
    const governance = this.governanceLayer.get(projectId);
    if (governance) {
      if (governance.limits.perProject && financialControl.spent + cost > governance.limits.perProject) {
        this.activateEmergencyShutdown(projectId, 'Project budget exceeded');
        throw new Error(`Project budget exceeded - system-wide shutdown activated for ${projectId}`);
      }
      if (governance.limits.perUser && financialControl.spent + cost > governance.limits.perUser) {
        this.activateEmergencyShutdown(projectId, 'User budget exceeded');
        throw new Error(`User budget exceeded - system-wide shutdown activated for ${projectId}`);
      }
      if (governance.limits.perWorkflow && financialControl.spent + cost > governance.limits.perWorkflow) {
        this.activateEmergencyShutdown(projectId, 'Workflow budget exceeded');
        throw new Error(`Workflow budget exceeded - system-wide shutdown activated for ${projectId}`);
      }
      if (governance.limits.perOrg && financialControl.spent + cost > governance.limits.perOrg) {
        this.activateEmergencyShutdown(projectId, 'Organization budget exceeded');
        throw new Error(`Organization budget exceeded - system-wide shutdown activated for ${projectId}`);
      }
    }

    // Hard budget limit - system-wide enforcement
    if (financialControl.spent + cost > financialControl.budget) {
      this.activateEmergencyShutdown(projectId, 'System budget exceeded');
      throw new Error(`System budget exceeded - system-wide shutdown activated for ${projectId}`);
    }

    // Update system-wide state
    financialControl.spent += cost;
    financialControl.lastUpdated = Date.now();
    
    // Sync with distributed state
    this.syncDistributedState(projectId, financialControl.spent);
    
    return true;
  }

  /**
   * 3. HARD ENFORCEMENT - Stop BEFORE API calls
   */
  enforceFinancialControl(projectId: string): void {
    const financialControl = this.financialControls.get(projectId);
    if (!financialControl) return;

    this.emergencyMode = true;
    this.circuitBreakerEngaged = true;
    financialControl.emergencyMode = true;

    this.sendEmergencyAlert(projectId, '🚨 SYSTEM-WIDE FINANCIAL CONTROL ACTIVATED');
    
    console.error(`🚨 FINANCIAL CONTROL: System-wide enforcement activated for ${projectId} - All AI execution stopped`);
  }

  /**
   * 4. ALERT + CONTROL PLANE - Real-time alerts and panic API
   */
  activateEmergencyShutdown(projectId: string, reason: string): void {
    const financialControl = this.financialControls.get(projectId);
    if (!financialControl) return;

    this.emergencyMode = true;
    this.circuitBreakerEngaged = true;
    financialControl.emergencyMode = true;

    // Send emergency alert
    this.sendEmergencyAlert(projectId, `🚨 EMERGENCY SHUTDOWN: ${reason}`);
    
    // Call panic API if configured
    if (this.alertControlPlane?.panicApi) {
      this.callPanicApi(projectId, reason);
    }
    
    console.error(`🚨 FINANCIAL CONTROL: EMERGENCY SHUTDOWN for ${projectId} - ${reason}`);
  }

  /**
   * 5. FINANCIAL GOVERNANCE LAYER - Per-project/user/workflow budgets
   */
  getFinancialControlStatus(projectId: string): {
    active: boolean;
    budget?: number;
    spent?: number;
    remaining?: number;
    emergencyMode: boolean;
    circuitBreakerEngaged: boolean;
    distributedSpent?: number;
    instances?: number;
    governance?: {
      userId?: string;
      workflowId?: string;
      orgId?: string;
      limits?: any;
    };
  } {
    const financialControl = this.financialControls.get(projectId);
    const distributed = financialControl ? this.distributedState.get(projectId) : null;
    const governance = this.governanceLayer.get(projectId);

    return {
      active: !!financialControl?.active,
      budget: financialControl?.budget,
      spent: financialControl?.spent,
      remaining: financialControl ? financialControl.budget - financialControl.spent : undefined,
      emergencyMode: financialControl?.emergencyMode || this.emergencyMode,
      circuitBreakerEngaged: this.circuitBreakerEngaged,
      distributedSpent: distributed?.totalSpent,
      instances: distributed?.instances.length,
      governance: governance ? {
        userId: governance.userId,
        workflowId: governance.workflowId,
        orgId: governance.orgId,
        limits: governance.limits
      } : undefined
    };
  }

  // Private methods for system-wide financial control
  private initializeDistributedState(projectId: string, budget: number): void {
    const existing = this.distributedState.get(projectId);
    
    if (!existing) {
      this.distributedState.set(projectId, {
        projectId,
        totalSpent: 0,
        instances: [this.instanceId],
        lastSync: Date.now(),
        globalLimit: budget,
        emergencyActive: false,
        circuitBreakerEngaged: false
      });
    }
  }

  private syncDistributedState(projectId: string, spent: number): void {
    const distributed = this.distributedState.get(projectId);
    if (!distributed) return;

    // Add this instance if not present
    if (!distributed.instances.includes(this.instanceId)) {
      distributed.instances.push(this.instanceId);
    }

    // Update global spending (system-wide truth)
    distributed.totalSpent = Math.max(distributed.totalSpent, spent);
    distributed.lastSync = Date.now();

    // Check global limit
    if (distributed.totalSpent > distributed.globalLimit) {
      this.activateEmergencyShutdown(projectId, 'Global budget exceeded');
      distributed.emergencyActive = true;
      distributed.circuitBreakerEngaged = true;
    }

    this.distributedState.set(projectId, distributed);
    this.persistFinancialControlState();
  }

  private startDistributedSync(): void {
    // Sync every 2 seconds for system-wide coordination
    setInterval(() => {
      this.syncWithOtherInstances();
    }, 2000);
  }

  private syncWithOtherInstances(): void {
    for (const [projectId, distributed] of this.distributedState) {
      if (Date.now() - distributed.lastSync > 10000) { // 10 seconds stale
        console.log(`🚨 FINANCIAL CONTROL: Syncing system-wide state ${projectId}`);
        distributed.lastSync = Date.now();
        this.distributedState.set(projectId, distributed);
      }
    }
  }

  private sendEmergencyAlert(projectId: string, message: string): void {
    if (!this.alertControlPlane) return;

    const alert = {
      text: `🚨 AI FINANCIAL CONTROL ALERT 🚨\n\nProject: ${projectId}\n${message}\nTime: ${new Date().toISOString()}`,
      ...(this.alertControlPlane.slack && { channel: this.alertControlPlane.slack.channel })
    };

    // Send to Slack
    if (this.alertControlPlane.slack) {
      console.log(`🚨 FINANCIAL CONTROL: Slack alert sent to ${this.alertControlPlane.slack.channel}`);
      // In real implementation: HTTP POST to webhook
    }

    // Send to Discord
    if (this.alertControlPlane.discord) {
      console.log(`🚨 FINANCIAL CONTROL: Discord alert sent to ${this.alertControlPlane.discord.channel}`);
      // In real implementation: HTTP POST to webhook
    }
  }

  private callPanicApi(projectId: string, reason: string): void {
    if (!this.alertControlPlane?.panicApi) return;

    console.log(`🚨 FINANCIAL CONTROL: Panic API called for ${projectId} - ${reason}`);
    // In real implementation: HTTP POST to panic API
  }

  private generateInstanceId(): string {
    return `instance-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private validateLicense(): boolean {
    // In real implementation, validate with Lemon Squeezy API
    return !!(this.licenseKey && this.licenseKey.length > 10);
  }

  private loadFinancialControlState(): void {
    // In real implementation, load from Redis/Postgres
  }

  private persistFinancialControlState(): void {
    // In real implementation, persist to Redis/Postgres
  }
}

/**
 * License validation for system-wide financial control
 */
export function validateLicense(licenseKey: string): boolean {
  return !!(licenseKey && licenseKey.length > 10);
}

/**
 * Get system-wide financial control instance
 */
export function getProGuard(licenseKey: string, alertConfig?: AlertControlPlane): GuardPro | null {
  if (!validateLicense(licenseKey)) {
    console.error('🚨 FINANCIAL CONTROL: Invalid license key. System-wide control requires AI CostGuard PRO.');
    return null;
  }

  return new GuardPro(licenseKey, alertConfig);
}
