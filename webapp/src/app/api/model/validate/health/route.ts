// app/api/model/validate/health/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { apiUrl, modelType } = body;

    if (!apiUrl) {
      return NextResponse.json(
        { message: "API URL is required", isValid: false },
        { status: 400 }
      );
    }

    // Construct the health endpoint URL
    const healthEndpoint = `${apiUrl}/health`;

    try {
      // Call the health endpoint of the external API
      const response = await fetch(healthEndpoint, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        // Add a timeout to prevent long-hanging requests
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        return NextResponse.json({
          message: `Health endpoint returned status: ${response.status}`,
          isValid: false,
          status: "error",
        }, { status: 200 });
      }

      const data = await response.json();

      // Check if the status is "healthy"
      if (data.status !== "healthy") {
        return NextResponse.json({
          message: `API endpoint is not healthy. Status: ${data.status}`,
          isValid: false,
          status: data.status,
          model: data.model,
        }, { status: 200 });
      }

      // For QWEN-7B, also check the model name
      if (modelType === "qwen-7b" && data.model !== "Deepseek-Qwen-Xray-7B") {
        return NextResponse.json({
          message: `Invalid model for QWEN-7B. Expected "Deepseek-Qwen-Xray-7B", got "${data.model}"`,
          isValid: false,
          status: data.status,
          model: data.model,
        }, { status: 200 });
      }

      // Validation passed
      return NextResponse.json({
        message: "API endpoint validated successfully",
        isValid: true,
        status: data.status,
        model: data.model,
      }, { status: 200 });

    } catch (error) {
      return NextResponse.json({
        message: error instanceof Error ? `Failed to connect to health endpoint: ${error.message}` : "Unknown error",
        isValid: false,
        status: "error",
      }, { status: 200 });
    }
  } catch (error) {
    return NextResponse.json({
      message: "Invalid request",
      isValid: false,
      status: "error",
    }, { status: 400 });
  }
}