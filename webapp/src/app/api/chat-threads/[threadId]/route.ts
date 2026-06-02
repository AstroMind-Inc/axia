// app/api/chat-threads/[threadId]/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

interface RouteParams {
  params: Promise<{
    threadId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { threadId } = resolvedParams;

    if (!ObjectId.isValid(threadId)) {
      return NextResponse.json({ message: 'Invalid thread ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    const thread = await appDb.collection('chat_threads').findOne({
      _id: new ObjectId(threadId)
    });

    if (!thread) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...thread,
      _id: thread._id.toString()
    });
  } catch (error) {
    console.error('Error fetching chat thread:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { threadId } = resolvedParams;
    const body = await request.json();

    if (!ObjectId.isValid(threadId)) {
      return NextResponse.json({ message: 'Invalid thread ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    const updateData = {
      ...body,
      updated_at: new Date()
    };

    // Don't allow updating _id or created_at
    delete updateData._id;
    delete updateData.created_at;

    const result = await appDb.collection('chat_threads').updateOne(
      { _id: new ObjectId(threadId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Thread updated successfully' });
  } catch (error) {
    console.error('Error updating chat thread:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { threadId } = resolvedParams;

    if (!ObjectId.isValid(threadId)) {
      return NextResponse.json({ message: 'Invalid thread ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    // Soft delete by setting status to archived
    const result = await appDb.collection('chat_threads').updateOne(
      { _id: new ObjectId(threadId) },
      { 
        $set: { 
          status: 'archived',
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Thread archived successfully' });
  } catch (error) {
    console.error('Error archiving chat thread:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}