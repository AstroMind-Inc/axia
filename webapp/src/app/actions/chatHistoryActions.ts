// app/actions/chatHistoryActions.ts
import { ChatThread, ChatMessage, ThreadWithMessages, MessageFeedback, FeedbackSubmission } from '@/app/types/chat-history';

// Chat Thread Actions
export async function createChatThread(
  title: string, 
  userId: string = 'default_user',
  selectedObject?: {
    data_obj_id: string;
    dataset_name: string;
    obsid: string | null;
    source_name: string | null;
    source_type: string | null;
  } | null
): Promise<ChatThread> {
  const response = await fetch('/api/chat-threads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, user_id: userId, selected_object: selectedObject }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create chat thread');
  }

  return response.json();
}

export async function getChatThreads(
  limit: number = 50, 
  skip: number = 0, 
  status: string = 'active'
): Promise<{ threads: ChatThread[]; total: number }> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    skip: skip.toString(),
    status,
  });

  const response = await fetch(`/api/chat-threads?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch chat threads');
  }

  return response.json();
}

export async function getChatThread(threadId: string): Promise<ChatThread> {
  const response = await fetch(`/api/chat-threads/${threadId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch chat thread');
  }

  return response.json();
}

export async function updateChatThread(threadId: string, updates: Partial<ChatThread>): Promise<void> {
  const response = await fetch(`/api/chat-threads/${threadId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update chat thread');
  }
}

export async function archiveChatThread(threadId: string): Promise<void> {
  const response = await fetch(`/api/chat-threads/${threadId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to archive chat thread');
  }
}

// Chat Message Actions
export async function getChatThreadWithMessages(threadId: string): Promise<ThreadWithMessages> {
  const response = await fetch(`/api/chat-threads/${threadId}/messages`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch chat thread with messages');
  }

  const data = await response.json();
  return {
    ...data.thread,
    messages: data.messages
  };
}

export async function saveChatMessage(threadId: string, messageData: Omit<ChatMessage, '_id' | 'thread_id' | 'message_index' | 'timestamp'>): Promise<ChatMessage> {
  const response = await fetch(`/api/chat-threads/${threadId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messageData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to save chat message');
  }

  return response.json();
}

// Feedback Actions
export async function submitMessageFeedback(feedbackData: FeedbackSubmission): Promise<MessageFeedback> {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(feedbackData),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to submit feedback');
  }

  return response.json();
}

export async function getMessageFeedback(messageId: string): Promise<MessageFeedback[]> {
  const response = await fetch(`/api/feedback/${messageId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to fetch message feedback');
  }

  const data = await response.json();
  return data.feedbacks;
}

// Utility function to generate thread title from first message
export function generateThreadTitle(firstMessage: string): string {
  // Take first 50 characters and add ellipsis if longer
  const title = firstMessage.trim();
  if (title.length <= 50) return title;
  
  const truncated = title.substring(0, 47);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > 20) {
    return truncated.substring(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}