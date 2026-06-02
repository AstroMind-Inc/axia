import { NextRequest, NextResponse } from 'next/server';
import { getServiceUrl } from '@/app/lib/service-url';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { object_data } = body;

    if (!object_data) {
      return NextResponse.json(
        { error: 'Object data is required' },
        { status: 400 }
      );
    }

    const backendUrl = getServiceUrl();
    
    // Create abort controller with 20 minute timeout for long-running neighbor analysis
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutes
    
    try {
      const response = await fetch(`${backendUrl}/v1/object-details-enhanced`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          object_data,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json(
          { error: errorData.error || 'Failed to process enhanced object details' },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Check if it's a timeout/abort error
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('Enhanced object details request timed out after 20 minutes');
        return NextResponse.json(
          { error: 'Request timed out after 20 minutes. Please try again or reduce the number of neighbors.' },
          { status: 504 }
        );
      }
      
      // Re-throw to be caught by outer catch
      throw fetchError;
    }

  } catch (error) {
    console.error('Error processing enhanced object details:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}