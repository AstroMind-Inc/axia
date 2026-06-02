// app/api/feedback/[messageId]/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

interface RouteParams {
  params: Promise<{
    messageId: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const resolvedParams = await params;
    const { messageId } = resolvedParams;

    if (!ObjectId.isValid(messageId)) {
      return NextResponse.json({ message: 'Invalid message ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    const feedbacks = await appDb
      .collection('chat_message_feedbacks')
      .find({ message_id: messageId })
      .sort({ timestamp: -1 })
      .toArray();

    return NextResponse.json({
      feedbacks: feedbacks.map(feedback => ({
        ...feedback,
        _id: feedback._id.toString()
      }))
    });
  } catch (error) {
    console.error('Error fetching message feedback:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}