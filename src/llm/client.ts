export interface LLMClient {
  complete(system: string, user: string, maxTokens: number): Promise<string>;
}
