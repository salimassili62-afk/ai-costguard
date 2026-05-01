export interface FirewallMetadata {
  orgId?: string;
  teamId?: string;
  appId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  workflowId?: string;
  apiKeyId?: string;
  requestId?: string;
  provider?: string;
  integration?: string;
  model?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface TokenBreakdown {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  imageUnits?: number;
}
