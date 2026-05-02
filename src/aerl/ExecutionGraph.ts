/**
 * AERL - Execution Graph Tracker
 * 
 * Tracks multi-step agent workflows as a directed graph:
 * - Nodes = actions (LLM calls, tool executions)
 * - Edges = dependencies between actions
 * 
 * DETECTS:
 * - Loops (A -> B -> A)
 * - Retry storms (rapid repeated calls)
 * - Redundant branches (identical subtrees)
 * - Stuck states (no progress for N steps)
 * 
 * REQUIREMENTS:
 * - Real-time updates
 * - In-memory (no external DB in hot path)
 * - Automatic cleanup
 * - <1ms update latency
 */

import { createHash } from 'crypto';

export type NodeType = 'llm' | 'tool' | 'decision' | 'retry';
export type NodeStatus = 'pending' | 'running' | 'success' | 'failure' | 'skipped';

export interface ExecutionNode {
  id: string;
  type: NodeType;
  status: NodeStatus;
  operation: string;
  inputHash: string;
  outputHash?: string;
  cost: number;
  tokens: number;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionEdge {
  from: string;
  to: string;
  type: 'dependency' | 'retry' | 'fallback';
}

export interface ExecutionGraph {
  workflowId: string;
  sessionId: string;
  nodes: Map<string, ExecutionNode>;
  edges: ExecutionEdge[];
  startTime: number;
  lastUpdate: number;
}

export interface GraphAnalysis {
  hasLoop: boolean;
  loopPath?: string[];
  retryStorm: boolean;
  retryCount: number;
  redundantBranches: string[][];
  stuckSteps: number; // Steps without progress
  depth: number;
  width: number;
}

export class ExecutionGraphTracker {
  private graphs: Map<string, ExecutionGraph>;
  private maxGraphs: number;
  private ttlMs: number;

  constructor(config?: { maxGraphs?: number; ttlMinutes?: number }) {
    this.graphs = new Map();
    this.maxGraphs = config?.maxGraphs || 5000;
    this.ttlMs = (config?.ttlMinutes || 60) * 60 * 1000;

    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Create or get graph for workflow
   */
  initGraph(workflowId: string, sessionId: string): ExecutionGraph {
    const existing = this.graphs.get(workflowId);
    if (existing) return existing;

    // Evict if at capacity
    if (this.graphs.size >= this.maxGraphs) {
      this.evictOldest();
    }

    const graph: ExecutionGraph = {
      workflowId,
      sessionId,
      nodes: new Map(),
      edges: [],
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };

    this.graphs.set(workflowId, graph);
    return graph;
  }

  /**
   * Add node to graph (real-time)
   */
  addNode(workflowId: string, node: ExecutionNode, dependencies?: string[]): void {
    const graph = this.graphs.get(workflowId);
    if (!graph) return;

    graph.nodes.set(node.id, node);

    // Add dependency edges
    if (dependencies) {
      for (const dep of dependencies) {
        graph.edges.push({
          from: dep,
          to: node.id,
          type: 'dependency',
        });
      }
    }

    graph.lastUpdate = Date.now();
  }

  /**
   * Update node status
   */
  updateNode(workflowId: string, nodeId: string, status: NodeStatus, outputHash?: string): void {
    const graph = this.graphs.get(workflowId);
    if (!graph) return;

    const node = graph.nodes.get(nodeId);
    if (node) {
      node.status = status;
      if (outputHash) node.outputHash = outputHash;
      graph.lastUpdate = Date.now();
    }
  }

  /**
   * Add retry edge
   */
  addRetry(workflowId: string, fromNodeId: string, toNodeId: string): void {
    const graph = this.graphs.get(workflowId);
    if (!graph) return;

    graph.edges.push({
      from: fromNodeId,
      to: toNodeId,
      type: 'retry',
    });

    graph.lastUpdate = Date.now();
  }

  /**
   * Analyze graph for problems
   */
  analyze(workflowId: string): GraphAnalysis {
    const graph = this.graphs.get(workflowId);
    if (!graph) {
      return {
        hasLoop: false,
        retryStorm: false,
        retryCount: 0,
        redundantBranches: [],
        stuckSteps: 0,
        depth: 0,
        width: 0,
      };
    }

    return {
      hasLoop: this.detectLoop(graph),
      retryStorm: this.detectRetryStorm(graph),
      retryCount: this.countRetries(graph),
      redundantBranches: this.findRedundantBranches(graph),
      stuckSteps: this.detectStuckState(graph),
      depth: this.calculateDepth(graph),
      width: this.calculateWidth(graph),
    };
  }

  /**
   * Detect loops using DFS
   */
  private detectLoop(graph: ExecutionGraph): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      // Find outgoing edges
      const outgoing = graph.edges.filter(e => e.from === nodeId);
      for (const edge of outgoing) {
        if (!visited.has(edge.to)) {
          if (dfs(edge.to)) return true;
        } else if (recursionStack.has(edge.to)) {
          return true; // Back edge found = loop
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * Detect retry storm (many retries in short time)
   */
  private detectRetryStorm(graph: ExecutionGraph): boolean {
    const retryEdges = graph.edges.filter(e => e.type === 'retry');
    if (retryEdges.length < 5) return false;

    // Group by target node
    const retryTargets = new Map<string, number>();
    for (const edge of retryEdges) {
      retryTargets.set(edge.to, (retryTargets.get(edge.to) || 0) + 1);
    }

    // Check if any target has >3 retries
    for (const count of retryTargets.values()) {
      if (count > 3) return true;
    }

    return false;
  }

  private countRetries(graph: ExecutionGraph): number {
    return graph.edges.filter(e => e.type === 'retry').length;
  }

  /**
   * Find redundant branches (subtrees with same input hash)
   */
  private findRedundantBranches(graph: ExecutionGraph): string[][] {
    const branches: string[][] = [];
    const inputHashes = new Map<string, string[]>();

    // Group nodes by input hash
    for (const [nodeId, node] of graph.nodes) {
      const existing = inputHashes.get(node.inputHash) || [];
      existing.push(nodeId);
      inputHashes.set(node.inputHash, existing);
    }

    // Find hashes with multiple nodes
    for (const [hash, nodeIds] of inputHashes) {
      if (nodeIds.length > 1) {
        branches.push(nodeIds);
      }
    }

    return branches;
  }

  /**
   * Detect stuck state (many steps without success)
   */
  private detectStuckState(graph: ExecutionGraph): number {
    const nodes = Array.from(graph.nodes.values());
    const recent = nodes.slice(-10); // Last 10 nodes

    const successes = recent.filter(n => n.status === 'success').length;
    return recent.length - successes;
  }

  /**
   * Calculate graph depth (longest path)
   */
  private calculateDepth(graph: ExecutionGraph): number {
    const depths = new Map<string, number>();

    const getDepth = (nodeId: string): number => {
      if (depths.has(nodeId)) return depths.get(nodeId)!;

      const incoming = graph.edges.filter(e => e.to === nodeId && e.type === 'dependency');
      if (incoming.length === 0) {
        depths.set(nodeId, 1);
        return 1;
      }

      const maxParentDepth = Math.max(...incoming.map(e => getDepth(e.from)));
      const depth = maxParentDepth + 1;
      depths.set(nodeId, depth);
      return depth;
    };

    let maxDepth = 0;
    for (const nodeId of graph.nodes.keys()) {
      maxDepth = Math.max(maxDepth, getDepth(nodeId));
    }

    return maxDepth;
  }

  /**
   * Calculate graph width (max parallel nodes)
   */
  private calculateWidth(graph: ExecutionGraph): number {
    // Simple: count nodes at each depth level
    const depthCounts = new Map<number, number>();

    // Calculate depth for each node
    const depths = new Map<string, number>();
    for (const nodeId of graph.nodes.keys()) {
      const incoming = graph.edges.filter(e => e.to === nodeId && e.type === 'dependency');
      const depth = incoming.length > 0 
        ? Math.max(...incoming.map(e => depths.get(e.from) || 0)) + 1
        : 1;
      depths.set(nodeId, depth);
      depthCounts.set(depth, (depthCounts.get(depth) || 0) + 1);
    }

    return Math.max(...depthCounts.values(), 0);
  }

  /**
   * Get graph for inspection
   */
  getGraph(workflowId: string): ExecutionGraph | undefined {
    return this.graphs.get(workflowId);
  }

  /**
   * Clear graph
   */
  clearGraph(workflowId: string): void {
    this.graphs.delete(workflowId);
  }

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [workflowId, graph] of this.graphs) {
      if (now - graph.lastUpdate > this.ttlMs) {
        expired.push(workflowId);
      }
    }

    for (const workflowId of expired) {
      this.graphs.delete(workflowId);
    }
  }

  private evictOldest(): void {
    let oldest: { id: string; time: number } | null = null;

    for (const [workflowId, graph] of this.graphs) {
      if (!oldest || graph.lastUpdate < oldest.time) {
        oldest = { id: workflowId, time: graph.lastUpdate };
      }
    }

    if (oldest) {
      this.graphs.delete(oldest.id);
    }
  }
}

export const graphTracker = new ExecutionGraphTracker();
