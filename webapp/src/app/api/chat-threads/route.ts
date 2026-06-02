// app/api/chat-threads/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { ChatThread } from '@/app/types/chat-history';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');
    const status = searchParams.get('status') || 'active';

    const { appDb } = await connectToMongoDB();

    const threads = await appDb
      .collection('chat_threads')
      .find({ status })
      .sort({ updated_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    return NextResponse.json({
      threads: threads.map(thread => ({
        ...thread,
        _id: thread._id.toString()
      })),
      total: await appDb.collection('chat_threads').countDocuments({ status })
    });
  } catch (error) {
    console.error('Error fetching chat threads:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, user_id = 'default_user', selected_object } = body;

    if (!title) {
      return NextResponse.json({ message: 'Title is required' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    const newThread: Omit<ChatThread, '_id'> = {
      title,
      created_at: new Date(),
      updated_at: new Date(),
      user_id,
      status: 'active',
      metadata: {
        total_messages: 0,
        last_model_used: null,
        last_source: {
          obsid: null,
          source_name: null,
          source_type: null
        },
        selected_object: selected_object || null
      }
    };

    const result = await appDb.collection('chat_threads').insertOne(newThread);

    return NextResponse.json({
      _id: result.insertedId.toString(),
      ...newThread
    });
  } catch (error) {
    console.error('Error creating chat thread:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}