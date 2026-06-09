const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;
const LETTER_PATTERN = /\p{L}/gu;
const ASCII_LETTER_PATTERN = /[A-Za-z]/g;
const SYMBOL_PATTERN = /[^\s\p{L}\p{N}]/gu;

type TextShape = 'normal' | 'structured' | 'code' | 'markdown' | 'multilingual' | 'repetitive';

interface TextStats {
  charCount: number;
  wordCount: number;
  symbolRatio: number;
  nonLatinLetterRatio: number;
  repeatedWordRatio: number;
}

/**
 * User-supplied tokenizer function for a model family.
 */
export type TokenizerFn = (text: string) => number;

interface RegisteredTokenizer {
  pattern: string | RegExp;
  fn: TokenizerFn;
}

interface TokenEstimate {
  tokens: number;
  approximate: boolean;
}

const registeredTokenizers: RegisteredTokenizer[] = [];

/**
 * Registers an exact or provider-specific tokenizer for matching model names.
 */
export function registerTokenizer(modelPattern: string | RegExp, fn: TokenizerFn): void {
  if (!(typeof modelPattern === 'string' && modelPattern.trim()) && !(modelPattern instanceof RegExp)) {
    throw new Error('registerTokenizer modelPattern must be a non-empty string or RegExp');
  }

  if (typeof fn !== 'function') {
    throw new Error('registerTokenizer fn must be a function');
  }

  registeredTokenizers.push({ pattern: modelPattern, fn });
}

/**
 * Estimates tokens for a plain text string using a calibrated dependency-free approximation.
 */
export function estimateTokensFromText(input: string): number {
  return estimateApproximateTokens(undefined, input);
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
  approximate: boolean;
} {
  const record = isRecord(params) ? params : {};
  const prompt = extractPrompt(record);
  const model = typeof record.model === 'string' ? record.model : undefined;
  const modelOverhead = Array.isArray(record.messages) ? record.messages.length * 3 + 3 : 0;
  const tokenEstimate = estimateTokensForModel(model, prompt);
  const inputTokens = tokenEstimate.tokens + modelOverhead;
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
    approximate: tokenEstimate.approximate,
  };
}

/**
 * Estimates text tokens using a registered tokenizer when one matches the model.
 */
export function estimateTokensForModel(model: string | undefined, text: string): TokenEstimate {
  const tokenizer = model ? findTokenizer(model) : undefined;

  if (tokenizer) {
    try {
      const tokens = tokenizer.fn(text);
      if (Number.isFinite(tokens) && tokens >= 0) {
        return { tokens: Math.max(0, Math.ceil(tokens)), approximate: false };
      }
    } catch {
      // Fall through to the approximation. GuardCore emits one warning per model/scope.
    }
  }

  return { tokens: estimateApproximateTokens(model, text), approximate: true };
}

function estimateApproximateTokens(model: string | undefined, input: string): number {
  const text = input.normalize('NFKC');
  const stats = inspectText(text);
  if (stats.charCount === 0) return 0;

  const shape = detectTextShape(text, stats);
  let estimate = stats.charCount / getCharsPerToken(model, shape);

  if (shape === 'normal') estimate = Math.max(estimate, stats.wordCount * 1.1);
  if (shape === 'structured') estimate = Math.max(estimate, stats.wordCount * 1.75);
  if (shape === 'code') estimate = Math.max(estimate, stats.wordCount * 1.55);
  if (shape === 'markdown') estimate = Math.max(estimate, stats.wordCount * 1.45);
  if (shape === 'multilingual') estimate = Math.max(estimate, stats.wordCount * 1.7);
  if (shape === 'repetitive') estimate = Math.max(stats.wordCount, estimate);

  return Math.max(1, Math.ceil(estimate));
}

function inspectText(text: string): TextStats {
  const words = text.match(WORD_PATTERN) ?? [];
  const letters = text.match(LETTER_PATTERN) ?? [];
  const asciiLetters = text.match(ASCII_LETTER_PATTERN) ?? [];
  const symbols = text.match(SYMBOL_PATTERN) ?? [];
  const normalizedWords = words.map((word) => word.toLowerCase());
  const uniqueWords = new Set(normalizedWords);

  return {
    charCount: [...text].length,
    wordCount: words.length,
    symbolRatio: symbols.length / Math.max(1, [...text].length),
    nonLatinLetterRatio: letters.length === 0 ? 0 : (letters.length - asciiLetters.length) / letters.length,
    repeatedWordRatio: words.length === 0 ? 1 : uniqueWords.size / words.length,
  };
}

function detectTextShape(text: string, stats: TextStats): TextShape {
  const trimmed = text.trim();

  if (stats.wordCount >= 6 && stats.repeatedWordRatio <= 0.35) return 'repetitive';
  if (looksLikeJson(trimmed) || looksLikeStructuredPayload(text)) return 'structured';
  if (/(^|\n)\s*[-*]\s|^#{1,6}\s/mu.test(text)) return 'markdown';
  if (looksCodeHeavy(text, stats)) return 'code';
  if (stats.nonLatinLetterRatio > 0.25) return 'multilingual';

  return 'normal';
}

function getCharsPerToken(model: string | undefined, shape: TextShape): number {
  if (shape === 'repetitive') return 5.8;
  if (shape === 'structured') return 3;
  if (shape === 'code') return 3.4;
  if (shape === 'markdown') return 3.8;
  if (shape === 'multilingual') return 3.1;
  if (model?.toLowerCase().includes('claude')) return 3.7;
  return 4.8;
}

function looksLikeJson(text: string): boolean {
  if (!((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) return false;

  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function looksLikeStructuredPayload(text: string): boolean {
  return /tool_call|request_id|retry_after|--[\w-]+|\b\w+=[^\s,]+/u.test(text);
}

function looksCodeHeavy(text: string, stats: TextStats): boolean {
  if (/\b(function|return|const|let|var|class|def|SELECT|FROM|WHERE|GROUP BY)\b|Error:/u.test(text)) {
    return true;
  }

  return /[{}();=<>]/u.test(text) && stats.symbolRatio > 0.08;
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

function findTokenizer(model: string): RegisteredTokenizer | undefined {
  const normalizedModel = model.trim().toLowerCase();

  return registeredTokenizers.find((tokenizer) => {
    if (typeof tokenizer.pattern === 'string') {
      return normalizedModel.includes(tokenizer.pattern.trim().toLowerCase());
    }

    tokenizer.pattern.lastIndex = 0;
    return tokenizer.pattern.test(model);
  });
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
