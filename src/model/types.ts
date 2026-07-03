/**
 * src/model/types.ts
 *
 * MODEL-01 / D5-01: Wire contract for the model adapter layer.
 *
 * PURE TYPE FILE — no runtime imports.
 * Imported by src/agent (05-02+); never importing the capture or spec layers (D5-01 boundary).
 */

/** Role of a chat message participant. */
export type ChatRole = 'system' | 'user' | 'assistant'

/**
 * A single content part — either plain text or a base64-encoded image for vision input.
 * No TypeScript enums: use as const / string-union types (native TS stripping convention).
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string }

/** A chat message with a role and content (text or multipart). */
export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

/**
 * Provider transport contract. Implemented by anthropic (raw fetch) and scripted (CI, no network).
 * MODEL-01: the transport layer — .chat() sends messages and returns the model's text reply.
 */
export interface Provider {
  id: string
  chat(messages: ChatMessage[]): Promise<string>
}

/** Parsed form of a `provider:model` spec string (e.g. 'anthropic:claude-haiku-4-5'). */
export interface ModelSpec {
  provider: string
  model: string
}
