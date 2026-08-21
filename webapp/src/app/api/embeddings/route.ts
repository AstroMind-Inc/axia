import { NextResponse } from 'next/server';
import { requestEmbeddings } from '@/app/lib/embeddings';
import { requireUserId } from '@/app/lib/authz';

export async function POST(request: Request) {
  try {
    const authz = await requireUserId();
    if ('error' in authz) return authz.error;

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

    const result = await requestEmbeddings({ event_list, model_api_url, is_pruned });
    return NextResponse.json(result.body, { status: result.status });

  } catch (error) {
    console.error('❌ Embeddings API error:', error);
    return NextResponse.json(
      { error: `Embeddings API error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
