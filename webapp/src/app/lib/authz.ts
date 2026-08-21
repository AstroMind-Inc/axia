import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { auth } from "@/auth";
import { isPublicCorpus, isSystemCollection } from "@/app/lib/collections";

export type AuthResult =
  | { userId: string }
  | { error: NextResponse };

export async function requireUserId(): Promise<AuthResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId };
}

export function notFound(): NextResponse {
  return NextResponse.json({ message: "Not found" }, { status: 404 });
}

export async function findOwnedThread(
  db: Db,
  threadId: string,
  userId: string,
) {
  if (!ObjectId.isValid(threadId)) return null;
  return db.collection("chat_threads").findOne({
    _id: new ObjectId(threadId),
    user_id: userId,
  });
}

export async function canAccessCollection(
  db: Db,
  collectionName: string,
  userId: string,
): Promise<boolean> {
  if (!collectionName || isSystemCollection(collectionName)) return false;
  if (isPublicCorpus(collectionName)) return true;
  const meta = await db.collection("metadata_records").findOne({
    collection_name: collectionName,
    user_id: userId,
  });
  return Boolean(meta);
}
