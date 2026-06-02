// app/api/feedback/route.ts
import { NextResponse } from 'next/server';
import { connectToMongoDB } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';
import { MessageFeedback, FeedbackSubmission } from '@/app/types/chat-history';

export async function POST(request: Request) {
  try {
    const body: FeedbackSubmission = await request.json();

    const { 
      message_id, 
      thread_id, 
      reviewer_info, 
      source_context, 
      conversation_context, 
      agent_evaluations, 
      feedback_details 
    } = body;

    if (!message_id || !thread_id || !reviewer_info.name) {
      return NextResponse.json({ 
        message: 'Missing required fields: message_id, thread_id, and reviewer name' 
      }, { status: 400 });
    }

    if (!ObjectId.isValid(message_id) || !ObjectId.isValid(thread_id)) {
      return NextResponse.json({ message: 'Invalid message ID or thread ID' }, { status: 400 });
    }

    const { appDb } = await connectToMongoDB();

    // Verify message and thread exist
    const message = await appDb.collection('chat_messages').findOne({
      _id: new ObjectId(message_id),
      thread_id: thread_id
    });

    if (!message) {
      return NextResponse.json({ message: 'Message not found' }, { status: 404 });
    }

    const thread = await appDb.collection('chat_threads').findOne({
      _id: new ObjectId(thread_id)
    });

    if (!thread) {
      return NextResponse.json({ message: 'Thread not found' }, { status: 404 });
    }

    const newFeedback: Omit<MessageFeedback, '_id'> = {
      message_id,
      thread_id,
      timestamp: new Date(),
      reviewer_info,
      source_context,
      conversation_context,
      agent_evaluations,
      feedback_details: {
        text_feedback: feedback_details.text_feedback || '',
        specific_issues: feedback_details.specific_issues || [],
        suggestions: feedback_details.suggestions || '',
        overall_rating: feedback_details.overall_rating || null
      },
      metadata: {
        feedback_version: '1.0',
        source_page: 'chat_interface'
      }
    };

    const result = await appDb.collection('chat_message_feedbacks').insertOne(newFeedback);

    return NextResponse.json({
      _id: result.insertedId.toString(),
      ...newFeedback,
      message: 'Feedback submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}