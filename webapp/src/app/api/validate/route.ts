// Proxy to the orchestrator's POST /v1/validate.
//
// Validates a chat assistant answer against the selected source's context
// using GPT-as-judge. Returns {result: {accuracy_rating, evaluation}, api_call_details}.
import { NextRequest, NextResponse } from 'next/server';
import { getServiceUrl } from '@/app/lib/service-url';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${getServiceUrl()}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { error: `Validation API error: ${text}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const jsonResponse = NextResponse.json(data);

    // Mirror the original webapp behaviour: surface a few diagnostics as headers.
    jsonResponse.headers.set('X-Validation-Source-ID', (body.sourceId || 'none').toString().slice(0, 100));
    jsonResponse.headers.set('X-Validation-Status', data?.result?.error ? 'error' : 'success');
    if (data?.api_call_details?.model) {
      jsonResponse.headers.set('X-OpenAI-Model', String(data.api_call_details.model).slice(0, 100));
    }
    return jsonResponse;
  } catch (error) {
    console.error('Validation route error:', error);
    return NextResponse.json(
      { error: `Failed to validate: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
