import { NextResponse } from "next/server";
import { connectToMongoDB } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
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

    return NextResponse.json({
      ...thread,
      _id: thread._id.toString(),
    });
  } catch (error) {
    console.error("Error fetching chat thread:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { threadId } = await params;
    const body = await request.json();
    const { appDb } = await connectToMongoDB();
    const thread = await findOwnedThread(appDb, threadId, authz.userId);

    if (!thread) return notFound();

    // Only the fields the UI edits. Spreading the body into $set let a client
    // write arbitrary fields (including dotted paths and very large values)
    // into its thread documents.
    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body?.title === "string") {
      updateData.title = body.title.slice(0, 200);
    }
    if (body?.status === "active" || body?.status === "archived") {
      updateData.status = body.status;
    }

    await appDb.collection("chat_threads").updateOne(
      { _id: new ObjectId(threadId), user_id: authz.userId },
      { $set: updateData },
    );

    return NextResponse.json({ message: "Thread updated successfully" });
  } catch (error) {
    console.error("Error updating chat thread:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const { threadId } = await params;
    const { appDb } = await connectToMongoDB();
    const thread = await findOwnedThread(appDb, threadId, authz.userId);

    if (!thread) return notFound();

    await appDb.collection("chat_threads").updateOne(
      { _id: new ObjectId(threadId), user_id: authz.userId },
      {
        $set: {
          status: "archived",
          updated_at: new Date(),
        },
      },
    );

    return NextResponse.json({ message: "Thread archived successfully" });
  } catch (error) {
    console.error("Error archiving chat thread:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
