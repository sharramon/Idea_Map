import * as dotenv from 'dotenv';
dotenv.config();

const PROVIDERS = ['anthropic', 'openai'] as const;
export type Provider = typeof PROVIDERS[number];

const rawProvider = process.env.IDEA_MAP_PROVIDER ?? 'openai';
if (!(PROVIDERS as readonly string[]).includes(rawProvider)) {
  console.error(`[config] Invalid IDEA_MAP_PROVIDER "${rawProvider}". Valid: ${PROVIDERS.join(', ')}`);
  process.exit(1);
}
const provider = rawProvider as Provider;

const defaultModels: Record<Provider, { extractor: string; verifier: string }> = {
  anthropic: { extractor: 'claude-sonnet-4-6', verifier: 'claude-haiku-4-5' },
  openai:    { extractor: 'gpt-4o-mini',       verifier: 'gpt-4o-mini'      },
};

const apiKeys: Record<Provider, string> = {
  anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  openai:    process.env.OPENAI_API_KEY    ?? '',
};

const apiKeyEnvVars: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai:    'OPENAI_API_KEY',
};

// Heuristics to detect if a model string looks like it belongs to a different provider
const modelPatterns: Record<Provider, RegExp> = {
  anthropic: /^claude-/,
  openai:    /^(gpt-|o[0-9]|text-)/,
};

export const config = {
  provider,
  apiKey: apiKeys[provider],
  models: {
    extractor: process.env.IDEA_MAP_EXTRACTOR_MODEL ?? defaultModels[provider].extractor,
    verifier:  process.env.IDEA_MAP_VERIFIER_MODEL  ?? defaultModels[provider].verifier,
  },
  defaults: {
    conservatism: 0.7,
  },
  embedding: {
    enabled:  process.env.IDEA_MAP_EMBEDDINGS === 'true',
    provider: (process.env.IDEA_MAP_EMBEDDING_PROVIDER ?? 'openai') as 'openai' | 'local',
    model:    process.env.IDEA_MAP_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    apiKey:   process.env.OPENAI_API_KEY ?? '',
  },
} as const;

export function validateConfig(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.apiKey) {
    errors.push(
      `Missing API key for provider "${provider}". Set ${apiKeyEnvVars[provider]} in your .env file.`
    );
  }

  for (const [role, model] of [['Extractor', config.models.extractor], ['Verifier', config.models.verifier]] as const) {
    if (!model) {
      errors.push(`${role} model is not set.`);
      continue;
    }

    for (const [otherProvider, pattern] of Object.entries(modelPatterns) as [Provider, RegExp][]) {
      if (otherProvider !== provider && pattern.test(model)) {
        warnings.push(
          `${role} model "${model}" looks like a ${otherProvider} model but IDEA_MAP_PROVIDER is "${provider}".`
        );
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\n[config] Warnings:');
    warnings.forEach(w => console.warn(`  · ${w}`));
  }

  if (errors.length > 0) {
    console.error('\n[config] Errors:');
    errors.forEach(e => console.error(`  · ${e}`));
    throw new Error('Invalid configuration — fix the errors above and try again.');
  }
}
