const TRIGRAM_SIZE = 3;

/**
 * Builds a character trigram frequency vector for a prompt.
 */
export function characterTrigrams(input: string): Map<string, number> {
  const normalized = normalizeForSimilarity(input);
  const vector = new Map<string, number>();

  if (normalized.length === 0) return vector;
  if (normalized.length < TRIGRAM_SIZE) {
    vector.set(normalized, 1);
    return vector;
  }

  for (let index = 0; index <= normalized.length - TRIGRAM_SIZE; index++) {
    const trigram = normalized.slice(index, index + TRIGRAM_SIZE);
    vector.set(trigram, (vector.get(trigram) ?? 0) + 1);
  }

  return vector;
}

/**
 * Calculates cosine similarity between two strings using character trigrams.
 */
export function cosineSimilarity(left: string, right: string): number {
  const leftVector = characterTrigrams(left);
  const rightVector = characterTrigrams(right);

  if (leftVector.size === 0 || rightVector.size === 0) return 0;

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const [key, leftValue] of leftVector) {
    dotProduct += leftValue * (rightVector.get(key) ?? 0);
    leftMagnitude += leftValue * leftValue;
  }

  for (const rightValue of rightVector.values()) {
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

/**
 * Returns the highest trigram cosine similarity between a prompt and a prompt history.
 */
export function maxCosineSimilarity(prompt: string, history: readonly string[]): number {
  return history.reduce((max, candidate) => Math.max(max, cosineSimilarity(prompt, candidate)), 0);
}

function normalizeForSimilarity(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}
