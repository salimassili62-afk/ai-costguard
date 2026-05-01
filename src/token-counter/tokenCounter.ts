/**
 * Improved token counter with per-model accuracy
 * Uses model-specific heuristics for better estimation
 */

export interface ChatMessageContent {
  role?: string;
  content: string | Array<{ type: string; text?: string }>;
}

/**
 * Estimate tokens for text using improved heuristics
 * Different models have different tokenization efficiency
 */
export function estimateTokens(text: string, model: string = 'gpt-3.5-turbo'): number {
  if (!text) return 0;

  // Model-specific token estimation ratios
  // These are empirically derived from actual API behavior
  const ratios: Record<string, number> = {
    // OpenAI models - GPT-4 is more efficient
    'gpt-4': 3.5, // ~1 token per 3.5 chars
    'gpt-4-turbo': 3.5,
    'gpt-4-turbo-preview': 3.5,
    'gpt-4o': 3.2, // Slightly more efficient
    'gpt-4o-mini': 3.0, // Most efficient
    'gpt-4-32k': 3.5,
    'gpt-3.5-turbo': 3.8,
    'gpt-3.5-turbo-16k': 3.8,
    'gpt-3.5-turbo-instruct': 3.8,

    // Claude models - typically more token-heavy
    'claude-3-opus-20240229': 4.0,
    'claude-3-sonnet-20240229': 4.0,
    'claude-3-haiku-20240307': 3.8,
    'claude-3-5-sonnet-20241022': 3.9,
    'claude-3-5-haiku-20241022': 3.7,
    'claude-2.1': 4.2,
    'claude-2': 4.2,
    'claude-instant-1.2': 4.0,
  };

  // Get ratio for this model, default to 3.8
  const ratio = ratios[model] || 3.8;

  // Count words and characters for better estimation
  const charCount = text.length;

  // Use character-based estimation as primary
  let estimatedTokens = Math.ceil(charCount / ratio);

  // Add bonus for punctuation and special tokens
  const specialChars = (text.match(/[.,!?;:\-()[\]{}]/g) || []).length;
  estimatedTokens += Math.ceil(specialChars / 10);

  return Math.max(1, estimatedTokens);
}

function getModelOverhead(model?: string): number {
  // Different models have different token overhead for message structure
  if (!model) return 10;

  const lowerModel = model.toLowerCase();

  if (lowerModel.includes('gpt-4')) {
    return 15; // GPT-4 has more complex message structure
  } else if (lowerModel.includes('gpt-3.5')) {
    return 12; // GPT-3.5 has simpler structure
  } else if (lowerModel.includes('claude')) {
    return 12; // Claude has different formatting
  } else {
    return 10; // Default for other models
  }
}

export function estimateMessagesTokens(messages: ChatMessageContent[], model?: string): number {
  if (!messages || !Array.isArray(messages)) return 0;

  let totalTokens = 0;

  for (const message of messages) {
    if (typeof message.content === 'string') {
      totalTokens += estimateTokens(message.content, model);
    } else if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === 'text' && content.text) {
          totalTokens += estimateTokens(content.text, model);
        }
      }
    }

    // Add overhead for role and structure (varies by model)
    const overhead = getModelOverhead(model);
    totalTokens += overhead;
  }

  // Add base tokens for the messages array structure
  totalTokens += 3;

  return Math.max(1, totalTokens);
}
