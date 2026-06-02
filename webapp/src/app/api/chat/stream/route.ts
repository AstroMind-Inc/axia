// app/api/chat/stream/route.ts
import { NextResponse } from 'next/server';
import { getServiceUrl } from '@/app/lib/service-url';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      message,
      history,
      model,
      model_api_url,
      response_format,
      embedding,
      event_list,
      data_obj,
      neighbors,
      context_settings,
      openai_model,
      thread_id,  // For database saving
      agent_config  // Agent configuration
    } = body;

    // Validate required fields
    if (!message || !history || !model || !response_format) {
      return NextResponse.json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Only support streaming for astromind-multi-agent model
    if (model !== "astromind-multi-agent") {
      return NextResponse.json(
        { message: 'Streaming is only supported for astromind-multi-agent model' },
        { status: 400 }
      );
    }

    // Transform the request to match the backend API model
    const transformedBody: {
      message: string;
      history: unknown[];
      model: string;
      model_api_url?: string;
      openai_model?: string;
      response_format: string;
      embedding?: number[];
      event_list?: number[][];
      data_obj?: unknown;
      neighbors?: unknown[];
      context_settings: unknown | null;
      thread_id?: string;
      agent_config?: {
        eventAnalyst: boolean;
        metadataAnalyst: boolean;
        neighborAnalyst: boolean;
        critic: boolean;
        toolAgent: boolean;
      };
    } = {
      message,
      history,
      model,
      response_format,
      context_settings: context_settings || null,
    };

    // Add model_api_url if present
    if (model_api_url) {
      transformedBody.model_api_url = model_api_url;
    }

    if (openai_model) {
      transformedBody.openai_model = openai_model;
    }

    // Add embedding if present
    if (embedding) {
      transformedBody.embedding = embedding;
    }

    // Add event_list if present
    if (event_list) {
      transformedBody.event_list = event_list;
    }

    // Add data_obj if present
    if (data_obj) {
      transformedBody.data_obj = data_obj;
    }

    // Add neighbors if present
    if (neighbors) {
      transformedBody.neighbors = neighbors;
    }

    // Add thread_id if present (IMPORTANT for DB saving!)
    if (thread_id) {
      transformedBody.thread_id = thread_id;
      console.log('✅ [API Route] Forwarding thread_id to backend:', thread_id);
    } else {
      console.warn('⚠️ [API Route] No thread_id received from frontend!');
    }

    // Add agent_config if present
    if (agent_config) {
      transformedBody.agent_config = agent_config;
      console.log('🔧 [API Route] Forwarding agent_config to backend:', agent_config);
    }

    // Get backend URL
    const backendUrl = getServiceUrl();

    console.log('🚀 Forwarding streaming request to backend:', `${backendUrl}/v1/chat/stream`);
    console.log('🔍 [API Route] transformedBody includes thread_id:', !!transformedBody.thread_id);

    // Make streaming request to FastAPI backend (NO timeout - streaming should not be aborted)
    const response = await fetch(`${backendUrl}/v1/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transformedBody),
      // Note: No signal/timeout for streaming - let it run as long as needed
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend streaming error:', response.status, errorText);
      return NextResponse.json(
        { message: `Backend error: ${errorText}` },
        { status: response.status }
      );
    }

    // Return the streaming response from backend
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    });

  } catch (error) {
    console.error('Streaming API error:', error);
    return NextResponse.json(
      { message: `Streaming API error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// Add environment variables types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_API_URL: string;
      API_KEY: string;
    }
  }
}