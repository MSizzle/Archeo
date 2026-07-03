/**
 * src/model/adapter.ts
 *
 * MODEL-01 / D5-01: Provider-agnostic factory.
 * Parses a `provider:model` spec string and constructs the right Provider.
 *
 * IMPORT BOUNDARY (D5-01): this module imports ONLY from src/model/ siblings and node: built-ins.
 * It NEVER imports from src/capture/ or src/spec/.
 */
import { createAnthropicProvider } from './providers/anthropic.ts'
import { createScriptedProvider } from './providers/scripted.ts'
import type { Provider, ModelSpec } from './types.ts'

/** Default model IDs used when only the provider name is supplied (e.g. 'scripted'). */
export const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5',
  scripted: 'frontier',
} as const

/**
 * Parse a `provider:model` string into a ModelSpec.
 *
 * Splits on the FIRST ':' only — 'a:b:c' yields { provider:'a', model:'b:c' }.
 * A bare provider name (no ':') uses DEFAULT_MODELS[provider].
 * Throws a clear Error naming the unknown provider.
 */
export function parseModelSpec(spec: string): ModelSpec {
  const idx = spec.indexOf(':')
  let provider: string
  let model: string

  if (idx === -1) {
    provider = spec
    if (!(provider in DEFAULT_MODELS)) {
      throw new Error(
        `Unknown provider: "${provider}". Supported: ${Object.keys(DEFAULT_MODELS).join(', ')}`,
      )
    }
    model = DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS]
  } else {
    provider = spec.slice(0, idx)
    model = spec.slice(idx + 1)
    if (!(provider in DEFAULT_MODELS)) {
      throw new Error(
        `Unknown provider: "${provider}". Supported: ${Object.keys(DEFAULT_MODELS).join(', ')}`,
      )
    }
  }

  return { provider, model }
}

/**
 * Construct a Provider from a `provider:model` spec string.
 *
 * - 'scripted' → createScriptedProvider() — no key, no network, deterministic
 * - 'anthropic:...' → requires opts.apiKey; throws "set ANTHROPIC_API_KEY" if missing
 * - Unknown provider → throws (same as parseModelSpec)
 */
export function createProvider(
  spec: string,
  opts?: {
    apiKey?: string
    baseUrl?: string
    fetchImpl?: typeof fetch
  },
): Provider {
  const { provider, model } = parseModelSpec(spec)

  switch (provider) {
    case 'scripted':
      return createScriptedProvider()

    case 'anthropic': {
      const apiKey = opts?.apiKey
      if (!apiKey) {
        throw new Error(
          'Set ANTHROPIC_API_KEY to use the anthropic provider (no apiKey supplied)',
        )
      }
      return createAnthropicProvider({
        apiKey,
        model,
        baseUrl: opts?.baseUrl,
        fetchImpl: opts?.fetchImpl,
      })
    }

    default:
      // parseModelSpec already validated the provider; this branch is unreachable
      throw new Error(`Unknown provider: "${provider}"`)
  }
}
