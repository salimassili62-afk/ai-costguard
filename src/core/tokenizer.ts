const TOKEN_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?[\p{L}]+| ?\p{N}{1,3}| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

const BPE_RANKS = new Map<string, number>(
  [
    't h',
    'h e',
    'i n',
    'e r',
    'a n',
    'r e',
    'o n',
    'a t',
    'e n',
    'n d',
    's t',
    'o r',
    'a l',
    'i t',
    'i s',
    't i',
    'n g',
    'c o',
    'd e',
    'l l',
    'm e',
    'p r',
    'o m',
    'p t',
    'r e',
    'e s',
    's i',
    'o u',
    'a r',
    'a i',
    'g p',
    'p t',
    'c l',
    'a u',
    'u d',
    'd e',
    'm o',
    'o d',
    'e l',
  ].map((pair, index) => [pair, index])
);

/**
 * Estimates tokens for a plain text string using a small inline BPE approximation.
 */
export function estimateTokensFromText(input: string): number {
  if (input.length === 0) return 0;

  const pieces = input.match(TOKEN_PATTERN) ?? [];
  const count = pieces.reduce((total, piece) => total + estimatePieceTokens(piece), 0);

  return Math.max(1, count);
}

/**
 * Extracts text from OpenAI-like or Anthropic-like message content.
 */
export function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join(' ');

  if (isRecord(value)) {
    const typedText = value.text ?? value.content ?? value.input ?? value.message;
    if (typedText !== undefined) return extractText(typedText);
  }

  return '';
}

/**
 * Estimates the input, output, and total token counts for an AI request payload.
 */
export function estimateRequestTokens(params: unknown): {
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  prompt: string;
} {
  const record = isRecord(params) ? params : {};
  const prompt = extractPrompt(record);
  const modelOverhead = Array.isArray(record.messages) ? record.messages.length * 3 + 3 : 0;
  const inputTokens = estimateTokensFromText(prompt) + modelOverhead;
  const outputTokens = readPositiveNumber(record.max_tokens) ??
    readPositiveNumber(record.max_completion_tokens) ??
    readPositiveNumber(record.maxTokens) ??
    readPositiveNumber(record.max_output_tokens) ??
    1000;

  return {
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    prompt,
  };
}

function estimatePieceTokens(piece: string): number {
  if (/^\s+$/u.test(piece)) return 1;
  if (/^\p{N}{1,3}$/u.test(piece.trim())) return 1;

  const normalized = piece.normalize('NFKC');
  if (/^[\p{P}\p{S}\s]+$/u.test(normalized)) {
    return Math.max(1, Math.ceil([...normalized].length / 2));
  }

  const symbols = applyApproximateBpe([...normalized.toLowerCase()]);
  return Math.max(1, symbols.length);
}

function applyApproximateBpe(initialSymbols: string[]): string[] {
  const symbols = [...initialSymbols];

  while (symbols.length > 1) {
    let bestIndex = -1;
    let bestRank = Number.POSITIVE_INFINITY;

    for (let index = 0; index < symbols.length - 1; index++) {
      const rank = BPE_RANKS.get(`${symbols[index]} ${symbols[index + 1]}`);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;

    symbols.splice(bestIndex, 2, `${symbols[bestIndex]}${symbols[bestIndex + 1]}`);
  }

  return symbols;
}

function extractPrompt(record: Record<string, unknown>): string {
  if (Array.isArray(record.messages)) {
    return record.messages
      .map((message) => (isRecord(message) ? extractText(message.content) : extractText(message)))
      .filter(Boolean)
      .join(' ');
  }

  return extractText(record.prompt ?? record.input ?? record.content ?? record.message);
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
