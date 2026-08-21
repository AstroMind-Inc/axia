import { NextResponse } from "next/server";
import { connectToMongoDB } from "@/app/lib/mongodb";
import { ObjectId } from "mongodb";
import { canAccessCollection, requireUserId } from "@/app/lib/authz";

function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

export async function POST(request: Request) {
  try {
    const authz = await requireUserId();
    if ("error" in authz) return authz.error;

    const body = await request.json();
    const { collection_name, object_id } = body;

    if (!collection_name || !object_id) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    const { dataDb, appDb } = await connectToMongoDB();

    let objectDetails = null;

    if (await canAccessCollection(dataDb, collection_name, authz.userId)) {
      if (isValidObjectId(object_id)) {
        try {
          objectDetails = await dataDb.collection(collection_name).findOne({
            _id: new ObjectId(object_id),
          });
        } catch (e) {
          console.log("ObjectId lookup failed, falling back to string-id lookup", e);
        }
      }

      if (!objectDetails) {
        try {
          objectDetails = await dataDb
            .collection(collection_name)
            .findOne({ _id: object_id as any });
        } catch (e) {
          console.log("String-id lookup failed", e);
        }
      }
    }

    if (!objectDetails) {
      try {
        const uploadedDataset = await appDb.collection("user_uploaded_sources").findOne(
          { user_id: authz.userId, "objects._id": object_id },
          { projection: { "objects.$": 1 } },
        );
        if (uploadedDataset?.objects?.length) {
          objectDetails = uploadedDataset.objects[0];
        }
      } catch (e) {
        console.log("Uploaded-sources lookup failed", e);
      }
    }

    if (!objectDetails) {
      return NextResponse.json({ message: "Object not found" }, { status: 404 });
    }

    return NextResponse.json(objectDetails);
  } catch (error) {
    console.error("Error fetching object details:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
