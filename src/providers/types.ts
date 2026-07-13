/**
 * Provider adapter boundary types (spec §17). The rest of the app only ever
 * sees ChatMessage in and NormalizedResponse out — provider-specific request and
 * response shapes never leak past this module.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** The one internal response structure every adapter must return (spec §17). */
export interface NormalizedResponse {
  text: string;
  model: string;
  finishReason: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  raw: unknown;
  durationMs: number;
  status: number;
}

export interface ChatRequestParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  seed?: number;
  stopSequences?: string[];
}
