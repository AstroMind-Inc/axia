import { NextResponse } from "next/server";
import { connectToMongoDB } from "@/app/lib/mongodb";
import { requireUserId } from "@/app/lib/authz";

const COLLECTION = "user_settings";

export async function GET() {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { db } = await connectToMongoDB();
    const settings = await db.collection(COLLECTION).findOne({ user_id: authz.userId });
    return NextResponse.json({ success: true, settings: settings || {} });
  } catch (error) {
    console.error("Error fetching user settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { feedContext, selectedFields, responseFormat } = await request.json();

    if (feedContext === undefined && !selectedFields && !responseFormat) {
      return NextResponse.json(
        { success: false, message: "No settings provided to update" },
        { status: 400 },
      );
    }

    const update: Record<string, unknown> = {
      user_id: authz.userId,
      last_updated: new Date(),
    };
    if (feedContext !== undefined) update.feedContext = feedContext;
    if (selectedFields) update.selectedFields = selectedFields;
    if (responseFormat) update.responseFormat = responseFormat;

    const { db } = await connectToMongoDB();
    const result = await db.collection(COLLECTION).updateOne(
      { user_id: authz.userId },
      { $set: update },
      { upsert: true },
    );

    return NextResponse.json({
      success: true,
      message: result.upsertedCount > 0 ? "Settings created" : "Settings updated",
      settings: update,
    });
  } catch (error) {
    console.error("Error saving user settings:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
