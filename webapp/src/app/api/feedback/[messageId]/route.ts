import { NextResponse } from "next/server";
import { connectToMongoDB } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { findOwnedThread, notFound, requireUserId } from "@/app/lib/authz";

interface RouteParams {
  params: Promise<{
    messageId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { messageId } = await params;

    if (!ObjectId.isValid(messageId)) {
      return NextResponse.json({ message: "Invalid message ID" }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    const message = await appDb.collection("chat_messages").findOne({
      _id: new ObjectId(messageId),
    });
    if (!message?.thread_id) return notFound();

    const thread = await findOwnedThread(appDb, message.thread_id, authz.userId);
    if (!thread) return notFound();

    const feedbacks = await appDb
      .collection("chat_message_feedbacks")
      .find({ message_id: messageId })
      .sort({ timestamp: -1 })
      .toArray();

    return NextResponse.json({
      feedbacks: feedbacks.map((feedback) => ({
        ...feedback,
        _id: feedback._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching message feedback:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
