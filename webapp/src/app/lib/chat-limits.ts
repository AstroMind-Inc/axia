// Size limits for chat requests, matching service/src/api/limits.py.
//
// The service rejects oversized requests outright. Long conversations are a
// normal way to exceed the history limit, so the webapp trims history to the
// most recent turns instead of letting the request fail.

export const MAX_MESSAGE_CHARS = 20_000;
const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 90_000;
const MAX_HISTORY_ITEM_CHARS = 40_000;

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/** Keep the most recent well-formed turns that fit the service's limits. */
export function trimHistory(history: unknown): ChatTurn[] {
  if (!Array.isArray(history)) return [];
  const turns: ChatTurn[] = history
    .filter(
      (m): m is ChatTurn =>
        m !== null &&
        typeof m === 'object' &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string',
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_ITEM_CHARS) }))
    .slice(-MAX_HISTORY_MESSAGES);

  let total = turns.reduce((n, m) => n + m.content.length, 0);
  while (turns.length && total > MAX_HISTORY_CHARS) {
    total -= turns.shift()!.content.length;
  }
  return turns;
}
