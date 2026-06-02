import { NextResponse } from 'next/server';
import { getServiceUrl } from '@/app/lib/service-url';

export async function POST(request: Request) {
  try {
    console.log('🔥 Embeddings API called');
    const body = await request.json();
    const { event_list, model_api_url, is_pruned } = body;

    console.log('📊 Received embeddings request:', {
      hasEventList: !!event_list,
      eventListLength: event_list ? event_list.length : 0,
      eventListType: typeof event_list,
      isArray: Array.isArray(event_list)
    });

    if (!event_list || !Array.isArray(event_list) || event_list.length === 0) {
      console.log('❌ Invalid event_list in embeddings request');
      return NextResponse.json({ 
        error: 'event_list is required and must be a non-empty array' 
      }, { status: 400 });
    }

    const backendUrl = getServiceUrl();
    const embeddingsUrl = `${backendUrl}/v1/embeddings`;

    console.log('🚀 Forwarding embeddings request to backend:', embeddingsUrl);
    console.log('   ↳ Flags:', { is_pruned: !!is_pruned, hasModelUrl: !!model_api_url });

    // Create abort controller with 20 minute timeout for large event lists
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes

    try {
      // Make request to FastAPI backend
      const response = await fetch(embeddingsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_list, model_api_url, is_pruned: !!is_pruned }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Backend embeddings error:', response.status, errorText);
        return NextResponse.json(
          { error: `Backend error: ${errorText}` },
          { status: response.status }
        );
      }

      const result = await response.json();
      console.log('📡 Service response received successfully');
      return NextResponse.json(result);
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Check if it's a timeout/abort error
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('Embeddings request timed out after 20 minutes');
        return NextResponse.json(
          { error: 'Request timed out after 20 minutes. Please try with a smaller event list.' },
          { status: 504 }
        );
      }
      
      // Re-throw to be caught by outer catch
      throw fetchError;
    }

  } catch (error) {
    console.error('❌ Embeddings API error:', error);
    return NextResponse.json(
      { error: `Embeddings API error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
