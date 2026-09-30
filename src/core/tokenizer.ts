const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;
const LETTER_PATTERN = /\p{L}/gu;
const ASCII_LETTER_PATTERN = /[A-Za-z]/g;
const SYMBOL_PATTERN = /[^\s\p{L}\p{N}]/gu;

/**
 * Conservative bytes-to-token ratio for non-text payload parts (images, audio, files).
 *
 * This is a floor, not a provider tokenizer. Real provider image tokenizers depend on
 * dimensions and detail level, which an in-process guard cannot see. The value is chosen
 * so that typical payloads are not under-counted by more than roughly 2x.
 */
const MEDIA_BYTES_PER_TOKEN = 750;

/**
 * Minimum tokens attributed to any present media part. Small thumbnails still cost tokens.
 */
const MIN_MEDIA_TOKENS = 85;

/**
 * Tokens attributed to a media part referenced by a remote URL whose size cannot be known
 * in-process. Documented heuristic; treat as a mid-size image.
 */
const REMOTE_MEDIA_TOKENS = 800;

/**
 * Above this many serialized characters, a structured payload is costed linearly instead of
 * being run through the text estimator, so a pathological schema cannot stall the guard.
 */
const LINEAR_SERIALIZATION_LIMIT = 500_000;

/** Fields that contribute billable input tokens but are not part of the conversation body. */
const BILLABLE_TEXT_FIELDS = ['system', 'instructions', 'developer', 'systemPrompt'] as const;

/** Structured request fields that providers bill as input tokens. */
const BILLABLE_STRUCTURED_FIELDS = ['tools', 'functions', 'response_format', 'text'] as const;

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

/**
 * Token estimate for one AI request, with an auditable costed surface.
 */
export interface RequestTokenEstimate {
  /** Estimated billable input tokens, including schemas, system prompts, media, and prompt replication. */
  inputTokens: number;
  /** Output limit requested for a single completion. Undefined when the request sets no output limit. */
  outputTokensPerCandidate?: number;
  /** Number of separately billed completions the request asks for. At least 1. */
  candidateCount: number;
  /** Number of separately billed prompts. At least 1; greater than 1 only for legacy prompt arrays. */
  promptCount: number;
  /** Total billable output tokens across every candidate and every prompt. Undefined when the request sets no output limit. */
  outputTokens?: number;
  /** Sum of inputTokens and outputTokens. */
  tokens: number;
  /** User-authored text used for loop and retry similarity. Excludes schemas and media. */
  prompt: string;
  /** True when dependency-free approximate token counting was used. */
  approximate: boolean;
  /** Tokens attributed to non-text parts such as images, audio, and files. */
  mediaTokens: number;
  /** Tokens attributed to tool/function schemas and response format definitions. */
  schemaTokens: number;
  /** True when the request carried at least one non-text part. */
  hasMediaInput: boolean;
  /** True when the request carried a tool, function, or response-format definition. */
  hasSchemaInput: boolean;
}

const registeredTokenizers: RegisteredTokenizer[] = [];

/**
 * Registers an exact or provider-specific tokenizer for matching model names.
 *
 * The registered function receives the text portion of the request only. Media parts and
 * serialized schemas are costed separately by fixed, documented constants.
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
 *
 * The estimate covers every part of the request a provider bills as input: the conversation
 * body, top-level system/instruction fields, tool and function schemas, response-format
 * definitions, and non-text media parts. Anything the estimator cannot see is costed with a
 * conservative fixed floor rather than counted as zero.
 */
export function estimateRequestTokens(params: unknown): RequestTokenEstimate {
  const record = isRecord(params) ? params : {};
  const model = typeof record.model === 'string' ? record.model : undefined;
  const prompt = extractPrompt(record);
  const instructionText = extractInstructionText(record);
  const schemaText = extractStructuredText(record);
  const media = estimateMediaTokens(record);

  const messageOverhead = Array.isArray(record.messages) ? record.messages.length * 3 + 3 : 0;
  const textSurface = joinSurfaces(prompt, instructionText, schemaText);
  const textEstimate = estimateTokensForModel(model, textSurface);
  const schemaTokens = schemaText ? estimateTokensForModel(model, schemaText).tokens : 0;

  // Providers bill every candidate and every prompt in a batch, so the reservation has to cover
  // the whole request rather than one completion.
  const candidateCount = readCandidateCount(record);
  const promptCount = readPromptCount(record);
  const inputTokens = (textEstimate.tokens + messageOverhead + media.tokens) * promptCount;

  const outputTokensPerCandidate =
    readPositiveNumber(record.max_tokens) ??
    readPositiveNumber(record.max_completion_tokens) ??
    readPositiveNumber(record.maxTokens) ??
    readPositiveNumber(record.max_output_tokens) ??
    readPositiveNumber(record.maxOutputTokens);

  // The two multipliers are independent, not alternatives. The legacy Completions API accepts both
  // `prompt: [...]` and `n` on the same request and returns `n` completions for each prompt, so the
  // billed output is maxTokens * candidates * prompts. Multiplying by candidates alone under-
  // reserved by a factor of promptCount for exactly the batched requests that cost the most.
  const outputTokens =
    outputTokensPerCandidate === undefined ? undefined : outputTokensPerCandidate * candidateCount * promptCount;

  return {
    inputTokens,
    outputTokensPerCandidate,
    candidateCount,
    promptCount,
    outputTokens,
    tokens: inputTokens + (outputTokens ?? 0),
    prompt,
    approximate: textEstimate.approximate,
    mediaTokens: media.tokens,
    schemaTokens,
    hasMediaInput: media.parts > 0,
    hasSchemaInput: schemaText.length > 0,
  };
}

/**
 * Reads how many separately billed completions a request asks for.
 *
 * `n` is the OpenAI Chat/Completions choice count. Anthropic always returns one completion.
 * Legacy `best_of` is deliberately ignored: only the best sequence is billed.
 */
function readCandidateCount(record: Record<string, unknown>): number {
  const requested =
    readPositiveNumber(record.n) ??
    readPositiveNumber(record.numChoices) ??
    readPositiveNumber(record.num_choices) ??
    readPositiveNumber(record.numberOfCompletions);

  if (requested === undefined) return 1;
  return Math.max(1, Math.min(1_000, Math.ceil(requested)));
}

/**
 * Reads how many separately billed prompts a request carries.
 *
 * The legacy Completions API accepts an array of prompts and bills each one. `messages` and the
 * Responses API `input` array are a single conversation and are never multiplied.
 */
function readPromptCount(record: Record<string, unknown>): number {
  if (!Array.isArray(record.prompt) || record.prompt.length === 0) return 1;
  return Math.min(1_000, record.prompt.length);
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
  const charCount = [...text].length;

  return {
    charCount,
    wordCount: words.length,
    symbolRatio: symbols.length / Math.max(1, charCount),
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
    return joinNonEmpty(
      record.messages.map((message) => (isRecord(message) ? extractText(message.content) : extractText(message)))
    );
  }

  return extractText(record.prompt ?? record.input ?? record.content ?? record.message);
}

function extractInstructionText(record: Record<string, unknown>): string {
  return joinNonEmpty(BILLABLE_TEXT_FIELDS.map((field) => extractText(record[field])));
}

function extractStructuredText(record: Record<string, unknown>): string {
  return joinNonEmpty(BILLABLE_STRUCTURED_FIELDS.map((field) => serializeStructured(record[field])));
}

function serializeStructured(value: unknown): string {
  if (value === undefined || value === null) return '';

  if (typeof value === 'string') return value;

  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? '';
  } catch {
    return '';
  }

  // A pathological schema must not stall the guard; charge it linearly instead.
  if (serialized.length > LINEAR_SERIALIZATION_LIMIT) {
    return serialized.slice(0, LINEAR_SERIALIZATION_LIMIT);
  }

  return serialized;
}

function estimateMediaTokens(record: Record<string, unknown>): { tokens: number; parts: number } {
  let tokens = 0;
  let parts = 0;

  for (const source of [record.messages, record.input, record.contents, record.content, record.parts]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      const content = entry.content ?? entry.parts;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const cost = estimateMediaPartTokens(part);
        if (cost === 0) continue;
        tokens += cost;
        parts += 1;
      }
    }
  }

  for (const field of ['image', 'image_url', 'audio', 'file', 'input_image', 'input_audio', 'b64_json']) {
    const cost = estimateMediaPartTokens(record[field]);
    if (cost === 0) continue;
    tokens += cost;
    parts += 1;
  }

  return { tokens, parts };
}

function estimateMediaPartTokens(part: unknown): number {
  if (typeof part === 'string') {
    return isTextPart(part) ? 0 : mediaTokensFromString(part);
  }

  if (!isRecord(part)) return 0;

  const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';
  if (type === 'text' || type === 'input_text' || type === 'output_text' || type === 'refusal') return 0;
  if (type.startsWith('text') || type === 'thinking' || type === 'redacted_thinking') return 0;

  for (const key of ['image_url', 'image', 'input_image', 'input_audio', 'audio', 'file', 'source', 'b64_json', 'url', 'data']) {
    const nested = part[key];
    if (nested === undefined || nested === null) continue;

    if (typeof nested === 'string') {
      const cost = mediaTokensFromString(nested);
      if (cost > 0) return cost;
      continue;
    }

    if (isRecord(nested)) {
      const data = typeof nested.data === 'string' ? nested.data : typeof nested.b64_json === 'string' ? nested.b64_json : undefined;
      if (data !== undefined) {
        const cost = mediaTokensFromData(data);
        if (cost > 0) return cost;
      }
      const url = typeof nested.url === 'string' ? nested.url : undefined;
      if (url !== undefined) {
        const cost = mediaTokensFromString(url);
        if (cost > 0) return cost;
      }
    }
  }

  return 0;
}

function isTextPart(value: string): boolean {
  return !/^data:/u.test(value) && !/^https?:\/\//u.test(value);
}

function mediaTokensFromString(value: string): number {
  if (value.startsWith('data:')) {
    const commaIndex = value.indexOf(',');
    return mediaTokensFromData(commaIndex === -1 ? value : value.slice(commaIndex + 1));
  }

  if (/^https?:\/\//u.test(value)) return REMOTE_MEDIA_TOKENS;
  return 0;
}

function mediaTokensFromData(data: string): number {
  if (!data) return 0;
  const decodedBytes = Math.ceil((base64ByteLength(data) * 3) / 4);
  return Math.max(MIN_MEDIA_TOKENS, Math.ceil(decodedBytes / MEDIA_BYTES_PER_TOKEN));
}

function base64ByteLength(data: string): number {
  let length = 0;
  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index);
    if (code === 61) break; // '='
    if (code > 32 && code < 127) length += 1;
  }
  return length;
}

function joinSurfaces(...parts: readonly string[]): string {
  return joinNonEmpty(parts);
}

function joinNonEmpty(parts: readonly (string | undefined)[]): string {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
  return kept.length === 1 ? kept[0]! : kept.join('\n');
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
