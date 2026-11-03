import { getServiceUrl } from '@/app/lib/service-url';

// Large event lists can take a long time to project, so allow up to 20 minutes.
const EMBEDDINGS_TIMEOUT_MS = 20 * 60 * 1000;

export interface EmbeddingsRequest {
  event_list: unknown[];
  model_api_url?: string | null;
  is_pruned?: boolean;
}

/** The service's /v1/embeddings response, or `{ error }` when the call failed. */
export interface EmbeddingsResponseBody {
  pca_64d?: number[] | null;
  umap_2d?: number[] | null;
  pruned_event_list?: number[][] | null;
  input_event_list?: number[][] | null;
  error?: string | null;
  errors?: string[];
  is_insufficient_window?: boolean;
}

export interface EmbeddingsResult {
  /** HTTP status to report for this request. */
  status: number;
  body: EmbeddingsResponseBody;
}

/**
 * Ask the FastAPI service to project an event list to (pca_64d, umap_2d).
 *
 * Server-side code must call this directly rather than fetching the webapp's
 * own /api/embeddings route. Behind Caddy, requests carry
 * `X-Forwarded-Proto: https`, so `request.nextUrl.origin` resolves to
 * `https://localhost:3000` while Next.js serves plain HTTP on that port, and
 * the self-call dies in the TLS handshake ("fetch failed").
 */
export async function requestEmbeddings({
  event_list,
  model_api_url,
  is_pruned,
}: EmbeddingsRequest): Promise<EmbeddingsResult> {
  const embeddingsUrl = `${getServiceUrl()}/v1/embeddings`;

  console.log('🚀 Forwarding embeddings request to backend:', embeddingsUrl);
  console.log('   ↳ Flags:', { is_pruned: !!is_pruned, hasModelUrl: !!model_api_url });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDINGS_TIMEOUT_MS);

  try {
    const response = await fetch(embeddingsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_list, model_api_url, is_pruned: !!is_pruned }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend embeddings error:', response.status, errorText);
      return { status: response.status, body: { error: `Backend error: ${errorText}` } };
    }

    const body = await response.json();
    console.log('📡 Service response received successfully');
    return { status: 200, body };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Embeddings request timed out after 20 minutes');
      return {
        status: 504,
        body: { error: 'Request timed out after 20 minutes. Please try with a smaller event list.' },
      };
    }
    console.error('❌ Embeddings API error:', error);
    return {
      status: 500,
      body: { error: `Embeddings API error: ${error instanceof Error ? error.message : 'Unknown error'}` },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
