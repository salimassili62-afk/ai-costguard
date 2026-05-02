/**
 * PolicyMarketplace.ts - Policy Ecosystem & Community Lock-in
 * 
 * Creates ecosystem dependency through:
 * - Reusable execution policies
 * - Community-shared guardrails
 * - Enterprise templates
 * - Verified policy publishers
 * 
 * Network Effects:
 * - More policies = more value for everyone
 * - Verified publishers create trust
 * - Templates reduce setup time to zero
 * - Switching = losing all community policies
 */

import { EventEmitter } from 'events';

// Types
export type PolicyCategory = 
  | 'cost_control' 
  | 'security' 
  | 'compliance' 
  | 'performance' 
  | 'reliability'
  | 'ethics';

export type PolicyStatus = 'draft' | 'published' | 'verified' | 'deprecated';

export interface MarketplacePolicy {
  id: string;
  name: string;
  description: string;
  version: string;
  category: PolicyCategory;
  status: PolicyStatus;
  
  // Publisher info
  publisherId: string;
  publisherName: string;
  publisherVerified: boolean;
  
  // Content
  rules: PolicyRuleDefinition[];
  configuration: Record<string, any>;
  documentation: string;
  examples: string[];
  
  // Metrics
  downloadCount: number;
  activeDeployments: number;
  averageRating: number;
  reviewCount: number;
  
  // Safety
  testedAgainst: string[]; // Test case IDs
  auditReport?: string;
  
  // Metadata
  createdAt: number;
  updatedAt: number;
  tags: string[];
  dependencies: string[]; // Other policy IDs
}

export interface PolicyRuleDefinition {
  name: string;
  description: string;
  condition: {
    type: string;
    operator: string;
    threshold: number | string | boolean;
  };
  action: 'allow' | 'warn' | 'throttle' | 'block';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface PolicyPublisher {
  publisherId: string;
  name: string;
  verified: boolean;
  policies: string[];
  totalDownloads: number;
  reputationScore: number;
}

export interface PolicyReview {
  reviewId: string;
  policyId: string;
  reviewerId: string;
  rating: number; // 1-5
  comment: string;
  deploymentContext: string; // e.g., "production", "testing"
  helpful: number; // Upvotes
  timestamp: number;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  policies: string[]; // Policy IDs
  configuration: Record<string, any>;
  useCases: string[];
  estimatedSetupTime: number; // minutes
}

/**
 * Policy Marketplace
 * 
 * Creates ecosystem lock-in through policy sharing.
 * Developers depend on community policies - switching becomes expensive.
 */
export class PolicyMarketplace extends EventEmitter {
  private policies: Map<string, MarketplacePolicy>;
  private publishers: Map<string, PolicyPublisher>;
  private reviews: Map<string, PolicyReview[]>; // policyId -> reviews
  private templates: Map<string, PolicyTemplate>;
  private userInstalls: Map<string, Set<string>>; // tenantId -> installed policy IDs
  
  // Featured and trending
  private featuredPolicies: string[];
  private trendingPolicies: string[];

  constructor() {
    super();
    this.policies = new Map();
    this.publishers = new Map();
    this.reviews = new Map();
    this.templates = new Map();
    this.userInstalls = new Map();
    this.featuredPolicies = [];
    this.trendingPolicies = [];
    
    // Seed with default policies
    this.seedDefaultPolicies();
  }

  /**
   * Publish a policy to the marketplace
   */
  publishPolicy(
    publisherId: string,
    policy: Omit<MarketplacePolicy, 'id' | 'publisherId' | 'downloadCount' | 'activeDeployments' | 'averageRating' | 'reviewCount' | 'createdAt' | 'updatedAt'>
  ): MarketplacePolicy {
    // Verify publisher
    const publisher = this.getOrCreatePublisher(publisherId);
    
    const newPolicy: MarketplacePolicy = {
      ...policy,
      id: `policy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      publisherId,
      downloadCount: 0,
      activeDeployments: 0,
      averageRating: 0,
      reviewCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.policies.set(newPolicy.id, newPolicy);
    publisher.policies.push(newPolicy.id);

    this.emit('policy:published', newPolicy);
    
    return newPolicy;
  }

  /**
   * Install a policy from marketplace
   * This creates dependency - removing marketplace loses access
   */
  installPolicy(tenantId: string, policyId: string): MarketplacePolicy | null {
    const policy = this.policies.get(policyId);
    if (!policy) return null;

    // Track install
    const installs = this.userInstalls.get(tenantId) || new Set();
    
    if (!installs.has(policyId)) {
      installs.add(policyId);
      this.userInstalls.set(tenantId, installs);
      
      // Update metrics
      policy.downloadCount++;
      policy.activeDeployments++;
      
      this.emit('policy:installed', { tenantId, policyId, policy });
    }

    return policy;
  }

  /**
   * Get installed policies for tenant
   */
  getInstalledPolicies(tenantId: string): MarketplacePolicy[] {
    const installs = this.userInstalls.get(tenantId) || new Set();
    return Array.from(installs)
      .map(id => this.policies.get(id))
      .filter((p): p is MarketplacePolicy => p !== undefined);
  }

  /**
   * Uninstall policy
   */
  uninstallPolicy(tenantId: string, policyId: string): boolean {
    const installs = this.userInstalls.get(tenantId);
    if (!installs || !installs.has(policyId)) return false;

    installs.delete(policyId);
    
    const policy = this.policies.get(policyId);
    if (policy) {
      policy.activeDeployments = Math.max(0, policy.activeDeployments - 1);
    }

    this.emit('policy:uninstalled', { tenantId, policyId });
    return true;
  }

  /**
   * Search policies
   */
  searchPolicies(query: {
    category?: PolicyCategory;
    status?: PolicyStatus;
    publisherVerified?: boolean;
    tags?: string[];
    minRating?: number;
    sortBy?: 'downloads' | 'rating' | 'recent';
    limit?: number;
  }): MarketplacePolicy[] {
    let results = Array.from(this.policies.values());

    // Apply filters
    if (query.category) {
      results = results.filter(p => p.category === query.category);
    }
    if (query.status) {
      results = results.filter(p => p.status === query.status);
    }
    if (query.publisherVerified !== undefined) {
      results = results.filter(p => {
        const publisher = this.publishers.get(p.publisherId);
        return publisher?.verified === query.publisherVerified;
      });
    }
    if (query.tags && query.tags.length > 0) {
      results = results.filter(p => 
        query.tags!.some(tag => p.tags.includes(tag))
      );
    }
    if (query.minRating !== undefined) {
      results = results.filter(p => p.averageRating >= (query.minRating || 0));
    }

    // Sort
    switch (query.sortBy) {
      case 'downloads':
        results.sort((a, b) => b.downloadCount - a.downloadCount);
        break;
      case 'rating':
        results.sort((a, b) => b.averageRating - a.averageRating);
        break;
      case 'recent':
      default:
        results.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return results.slice(0, query.limit || 20);
  }

  /**
   * Get policy by ID
   */
  getPolicy(policyId: string): MarketplacePolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * Submit review
   */
  submitReview(review: Omit<PolicyReview, 'reviewId' | 'helpful' | 'timestamp'>): PolicyReview {
    const newReview: PolicyReview = {
      ...review,
      reviewId: `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      helpful: 0,
      timestamp: Date.now(),
    };

    const reviews = this.reviews.get(review.policyId) || [];
    reviews.push(newReview);
    this.reviews.set(review.policyId, reviews);

    // Update policy rating
    this.updatePolicyRating(review.policyId);

    this.emit('review:submitted', newReview);
    return newReview;
  }

  /**
   * Get reviews for policy
   */
  getReviews(policyId: string): PolicyReview[] {
    return this.reviews.get(policyId) || [];
  }

  /**
   * Create policy template
   */
  createTemplate(template: Omit<PolicyTemplate, 'id'>): PolicyTemplate {
    const newTemplate: PolicyTemplate = {
      ...template,
      id: `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    this.templates.set(newTemplate.id, newTemplate);
    this.emit('template:created', newTemplate);
    
    return newTemplate;
  }

  /**
   * Get template
   */
  getTemplate(templateId: string): PolicyTemplate | undefined {
    return this.templates.get(templateId);
  }

  /**
   * Apply template (install all policies)
   */
  applyTemplate(tenantId: string, templateId: string): {
    success: boolean;
    installed: string[];
    failed: string[];
  } {
    const template = this.templates.get(templateId);
    if (!template) {
      return { success: false, installed: [], failed: [] };
    }

    const installed: string[] = [];
    const failed: string[] = [];

    for (const policyId of template.policies) {
      const policy = this.installPolicy(tenantId, policyId);
      if (policy) {
        installed.push(policyId);
      } else {
        failed.push(policyId);
      }
    }

    this.emit('template:applied', { tenantId, templateId, installed, failed });

    return {
      success: failed.length === 0,
      installed,
      failed,
    };
  }

  /**
   * Get featured policies
   */
  getFeatured(): MarketplacePolicy[] {
    return this.featuredPolicies
      .map(id => this.policies.get(id))
      .filter((p): p is MarketplacePolicy => p !== undefined);
  }

  /**
   * Get trending policies
   */
  getTrending(): MarketplacePolicy[] {
    return this.trendingPolicies
      .map(id => this.policies.get(id))
      .filter((p): p is MarketplacePolicy => p !== undefined);
  }

  /**
   * Set featured policies
   */
  setFeatured(policyIds: string[]): void {
    this.featuredPolicies = policyIds;
  }

  /**
   * Calculate switching cost
   * Shows how expensive it would be to leave the marketplace
   */
  calculateSwitchingCost(tenantId: string): {
    installedPolicies: number;
    customConfigurations: number;
    estimatedReconfigurationHours: number;
    riskLevel: 'low' | 'medium' | 'high' | 'extreme';
  } {
    const installed = this.getInstalledPolicies(tenantId);
    
    // Calculate reconfiguration effort
    const configHours = installed.reduce((sum, p) => {
      return sum + (p.rules.length * 0.5) + (p.examples.length * 0.25);
    }, 0);

    let riskLevel: 'low' | 'medium' | 'high' | 'extreme' = 'low';
    if (installed.length > 50) riskLevel = 'extreme';
    else if (installed.length > 20) riskLevel = 'high';
    else if (installed.length > 5) riskLevel = 'medium';

    return {
      installedPolicies: installed.length,
      customConfigurations: installed.length,
      estimatedReconfigurationHours: Math.ceil(configHours),
      riskLevel,
    };
  }

  /**
   * Get marketplace metrics
   */
  getMetrics(): {
    totalPolicies: number;
    totalPublishers: number;
    totalInstalls: number;
    verifiedPolicies: number;
    averageRating: number;
  } {
    const policies = Array.from(this.policies.values());
    const verifiedCount = policies.filter(p => p.status === 'verified').length;
    const totalRating = policies.reduce((sum, p) => sum + p.averageRating, 0);
    
    let totalInstalls = 0;
    for (const installs of this.userInstalls.values()) {
      totalInstalls += installs.size;
    }

    return {
      totalPolicies: policies.length,
      totalPublishers: this.publishers.size,
      totalInstalls,
      verifiedPolicies: verifiedCount,
      averageRating: policies.length > 0 ? totalRating / policies.length : 0,
    };
  }

  // Private methods

  private getOrCreatePublisher(publisherId: string): PolicyPublisher {
    let publisher = this.publishers.get(publisherId);
    
    if (!publisher) {
      publisher = {
        publisherId,
        name: publisherId, // Default to ID
        verified: false,
        policies: [],
        totalDownloads: 0,
        reputationScore: 50,
      };
      this.publishers.set(publisherId, publisher);
    }

    return publisher;
  }

  private updatePolicyRating(policyId: string): void {
    const reviews = this.reviews.get(policyId) || [];
    if (reviews.length === 0) return;

    const policy = this.policies.get(policyId);
    if (!policy) return;

    const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
    policy.averageRating = totalRating / reviews.length;
    policy.reviewCount = reviews.length;
  }

  private seedDefaultPolicies(): void {
    // Cost control starter pack
    this.publishPolicy('system', {
      name: 'Starter Cost Control',
      description: 'Basic cost protection for new deployments',
      version: '1.0.0',
      category: 'cost_control',
      status: 'verified',
      publisherName: 'ExecutionOS Team',
      publisherVerified: true,
      rules: [
        {
          name: 'Max $10 per execution',
          description: 'Block executions estimated to cost more than $10',
          condition: { type: 'cost', operator: 'gt', threshold: 10 },
          action: 'block',
          severity: 'high',
        },
        {
          name: 'Loop detection',
          description: 'Block suspected infinite loops',
          condition: { type: 'repetition', operator: 'gt', threshold: 5 },
          action: 'block',
          severity: 'critical',
        },
      ],
      configuration: {},
      documentation: 'Basic cost protection rules for all deployments',
      examples: ['Prevents runaway agent costs', 'Blocks recursive loops'],
      testedAgainst: ['test-cost-spike', 'test-loop-detection'],
      tags: ['starter', 'cost', 'recommended'],
      dependencies: [],
    });

    // Security pack
    this.publishPolicy('system', {
      name: 'Security Guardrails',
      description: 'Prevent common security issues in AI execution',
      version: '1.0.0',
      category: 'security',
      status: 'verified',
      publisherName: 'ExecutionOS Security Team',
      publisherVerified: true,
      rules: [
        {
          name: 'Prompt injection detection',
          description: 'Detect and block potential prompt injection attempts',
          condition: { type: 'pattern', operator: 'contains', threshold: 'ignore previous instructions' },
          action: 'block',
          severity: 'critical',
        },
      ],
      configuration: {},
      documentation: 'Security-focused policy pack',
      examples: ['Blocks prompt injection', 'Prevents jailbreak attempts'],
      testedAgainst: ['test-prompt-injection'],
      tags: ['security', 'recommended', 'enterprise'],
      dependencies: [],
    });

    // Create starter template
    this.createTemplate({
      name: 'Production Starter',
      description: 'Recommended policies for production AI agents',
      category: 'starter',
      policies: Array.from(this.policies.keys()).slice(0, 2),
      configuration: { autoApply: true },
      useCases: ['Production AI agents', 'Customer-facing applications'],
      estimatedSetupTime: 5,
    });

    // Set featured
    this.setFeatured(Array.from(this.policies.keys()).slice(0, 5));
  }
}

// Export singleton
export const policyMarketplace = new PolicyMarketplace();
