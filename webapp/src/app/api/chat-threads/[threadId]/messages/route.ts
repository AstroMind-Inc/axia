// app/api/chat-threads/[threadId]/messages/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { ChatMessage } from '@/app/types/chat-history';

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

    // Verify thread exists
    const thread = await appDb.collection('chat_threads').findOne({
      _id: new ObjectId(threadId)
    });

    if (!thread) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    // Get messages for the thread
    const messages = await appDb
      .collection('chat_messages')
      .find({ thread_id: threadId })
      .sort({ message_index: 1 })
      .toArray();

    return NextResponse.json({
      thread: {
        ...thread,
        _id: thread._id.toString()
      },
      messages: messages.map(message => ({
        ...message,
        _id: message._id.toString()
      }))
    });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { threadId } = resolvedParams;
    const body = await request.json();

    console.log('POST /chat-threads/:threadId/messages - threadId:', threadId, 'body type:', body.message_type);

    if (!ObjectId.isValid(threadId)) {
      return NextResponse.json({ message: 'Invalid thread ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    // Verify thread exists
    const thread = await appDb.collection('chat_threads').findOne({
      _id: new ObjectId(threadId)
    });

    if (!thread) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    // Get the next message index
    const lastMessage = await appDb
      .collection('chat_messages')
      .findOne(
        { thread_id: threadId },
        { sort: { message_index: -1 } }
      );

    const nextIndex = lastMessage ? lastMessage.message_index + 1 : 0;

    const newMessage: Omit<ChatMessage, '_id'> = {
      thread_id: threadId,
      message_index: nextIndex,
      timestamp: new Date(),
      message_type: body.message_type,
      user_input: body.user_input || undefined,
      assistant_response: body.assistant_response || undefined
    };

    const result = await appDb.collection('chat_messages').insertOne(newMessage);
    console.log('Message inserted with ID:', result.insertedId.toString());

    // Update thread metadata
    const updateData: any = {
      updated_at: new Date(),
      'metadata.total_messages': nextIndex + 1
    };

    if (body.assistant_response?.model_used) {
      updateData['metadata.last_model_used'] = body.assistant_response.model_used;
    }

    if (body.user_input?.selected_object) {
      updateData['metadata.last_source'] = {
        obsid: body.user_input.selected_object.obsid,
        source_name: body.user_input.selected_object.source_name,
        source_type: body.user_input.selected_object.source_type
      };
    }

    const updateResult = await appDb.collection('chat_threads').updateOne(
      { _id: new ObjectId(threadId) },
      { $set: updateData }
    );
    console.log('Thread updated, matched:', updateResult.matchedCount, 'modified:', updateResult.modifiedCount);

    return NextResponse.json({
      _id: result.insertedId.toString(),
      ...newMessage
    });
  } catch (error) {
    console.error('Error creating chat message:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}