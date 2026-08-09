export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  /**
   * Overrides the configured model for this call.
   *
   * Free-tier quotas are counted per model, so spending the good model's
   * daily allowance on a mechanical task like query rewriting is waste.
   */
  model?: string;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}
