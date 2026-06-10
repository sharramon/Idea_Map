import { config } from '../config';
import { LLMClient } from './client';
import { AnthropicClient } from './anthropic';
import { OpenAIClient } from './openai';

export { LLMClient };

export function createClient(
  role: 'extractor' | 'verifier',
  overrides?: { apiKey?: string; model?: string },
): LLMClient {
  const apiKey = overrides?.apiKey || config.apiKey;
  const model  = overrides?.model  || config.models[role];

  switch (config.provider) {
    case 'anthropic': return new AnthropicClient(apiKey, model);
    case 'openai':    return new OpenAIClient(apiKey, model);
  }
}
