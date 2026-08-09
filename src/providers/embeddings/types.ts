export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  /** Embeds corpus text. Uses a retrieval-document task type where supported. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** Embeds a search query. Uses a retrieval-query task type where supported. */
  embedQuery(text: string): Promise<number[]>;
}
