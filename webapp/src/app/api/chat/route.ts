// app/api/chat/route.ts
import api from '@/app/lib/api';
import { NextResponse } from 'next/server';

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
      openai_model
    } = body;

    // Validate required fields
    if (!message || !history || !model || !response_format) {
      return NextResponse.json(
        { message: 'Missing required fields' },
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
      event_list?: number[][];  // Updated to properly type as 2D array
      data_obj?: unknown;  // Added data_obj for astromind-openai model
      neighbors?: unknown[];  // Added neighbors for multi-agent analysis
      context_settings: unknown | null;
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

    // Add the appropriate data based on model type
    if (model === "astromind-openai") {
      // For astromind-openai model, use data_obj if available
      if (data_obj) {
        transformedBody.data_obj = data_obj;
      }
    } else if (model === "astromind-multi-agent") {
      // For multi-agent model, pass data_obj, event_list, and neighbors
      if (data_obj) {
        transformedBody.data_obj = data_obj;
      }
      if (event_list && Array.isArray(event_list)) {
        // Validate that event_list is a 2D array
        if (event_list.length > 0 && Array.isArray(event_list[0])) {
          transformedBody.event_list = event_list;
        }
      }
      if (neighbors && Array.isArray(neighbors)) {
        transformedBody.neighbors = neighbors;
        console.log(`🔍 Debug - Proxy forwarding neighbors: ${neighbors.length} neighbors`);
      }
    } else if (model === "qwen-7b-raw-xray-event") {
      // For event list models, use event_list if available
      if (event_list && Array.isArray(event_list)) {
        // Validate that event_list is a 2D array
        if (event_list.length > 0 && Array.isArray(event_list[0])) {
          transformedBody.event_list = event_list;
          console.log(`Using event_list data for model: ${model}, with ${event_list.length} events`);
        } else {
          console.error('Invalid event_list format: expected 2D array');
          return NextResponse.json(
            { message: 'Invalid event_list format. Expected 2D array of numbers.' },
            { status: 400 }
          );
        }
      } else {
        console.warn(`Model ${model} requires event_list data but none provided or invalid format`);
        return NextResponse.json(
          { message: 'This model requires event list data which was not provided or is invalid.' },
          { status: 400 }
        );
      }
    } else {
      // For other models, use embedding data (if available)
      if (embedding && Array.isArray(embedding)) {
        transformedBody.embedding = embedding;
      } else {
        // If no embedding and not an event_list model, log a warning
        console.warn(`No embedding provided for model: ${model}`);
      }
    }

    // Make the API call with a specific timeout just for this request
    const response = await api.post(`/chat`, transformedBody, {
      timeout: 1200000 // 20 minute timeout for multi-agent workflows
    });

    return NextResponse.json(response.data);
  } catch (error) {
    console.error('Chat API error:', error);

    // TypeSafe check for Axios timeout errors
    if (error instanceof Error) {
      const axiosError = error as any; // Type assertion for flexibility

      if (axiosError.code === 'ECONNABORTED' ||
         (axiosError.message && axiosError.message.includes('timeout'))) {
        return NextResponse.json(
          { message: 'Request timed out after 20 minutes. Please try again.' },
          { status: 504 } // Gateway Timeout status
        );
      }

      // Handle specific API errors from backend if possible
      if (axiosError.response?.data?.message) {
        return NextResponse.json(
          { message: axiosError.response.data.message },
          { status: axiosError.response.status || 500 }
        );
      }

      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { message: 'Internal server error' },
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