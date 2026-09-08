import { NextResponse } from "next/server";
import { connectToMongoDB } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { ChatMessage } from "@/app/types/chat-history";
import { findOwnedThread, notFound, requireUserId } from "@/app/lib/authz";

interface RouteParams {
  params: Promise<{
    threadId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { threadId } = await params;
    const { appDb } = await connectToMongoDB();
    const thread = await findOwnedThread(appDb, threadId, authz.userId);

    if (!thread) return notFound();

    const messages = await appDb
      .collection("chat_messages")
      .find({ thread_id: threadId })
      .sort({ message_index: 1 })
      .toArray();

    return NextResponse.json({
      thread: {
        ...thread,
        _id: thread._id.toString(),
      },
      messages: messages.map((message) => ({
        ...message,
        _id: message._id.toString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { threadId } = await params;
    const body = await request.json();
    const { appDb } = await connectToMongoDB();
    const thread = await findOwnedThread(appDb, threadId, authz.userId);

    if (!thread) return notFound();

    const lastMessage = await appDb.collection("chat_messages").findOne(
      { thread_id: threadId },
      { sort: { message_index: -1 } },
    );

    const nextIndex = lastMessage ? lastMessage.message_index + 1 : 0;

    const newMessage: Omit<ChatMessage, "_id"> = {
      thread_id: threadId,
      message_index: nextIndex,
      timestamp: new Date(),
      message_type: body.message_type,
      user_input: body.user_input || undefined,
      assistant_response: body.assistant_response || undefined,
    };

    const result = await appDb.collection("chat_messages").insertOne(newMessage);

    const updateData: Record<string, unknown> = {
      updated_at: new Date(),
      "metadata.total_messages": nextIndex + 1,
    };

    if (body.assistant_response?.model_used) {
      updateData["metadata.last_model_used"] = body.assistant_response.model_used;
    }

    if (body.user_input?.selected_object) {
      updateData["metadata.last_source"] = {
        obsid: body.user_input.selected_object.obsid,
        source_name: body.user_input.selected_object.source_name,
        source_type: body.user_input.selected_object.source_type,
      };
    }

    await appDb.collection("chat_threads").updateOne(
      { _id: new ObjectId(threadId), user_id: authz.userId },
      { $set: updateData },
    );

    return NextResponse.json({
      _id: result.insertedId.toString(),
      ...newMessage,
    });
  } catch (error) {
    console.error("Error creating chat message:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
