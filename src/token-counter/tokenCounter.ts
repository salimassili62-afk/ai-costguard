/**
 * Simple token counter for estimation
 * Uses approximate character-to-token ratio
 * For production, use tiktoken or similar
 */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Approximate: 1 token ≈ 4 characters for English text
  // This is a rough estimate - for production use tiktoken
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: any[]): number {
  if (!messages || !Array.isArray(messages)) return 0;
  
  let totalTokens = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      totalTokens += estimateTokens(message.content);
    } else if (Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === 'text') {
          totalTokens += estimateTokens(content.text);
        }
      }
    }
    // Add overhead for role and structure
    totalTokens += 10;
  }
  
  return totalTokens;
}
