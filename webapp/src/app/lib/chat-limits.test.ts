import { describe, expect, it } from 'vitest';
import { trimHistory } from './chat-limits';

describe('trimHistory', () => {
  it('drops malformed entries and unknown roles', () => {
    expect(
      trimHistory([
        { role: 'user', content: 'a' },
        { role: 'system', content: 'b' },
        { role: 'assistant', content: 3 },
        null,
        'x',
      ]),
    ).toEqual([{ role: 'user', content: 'a' }]);
  });

  it('keeps only the most recent 40 turns', () => {
    const h = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: String(i) }));
    const out = trimHistory(h);
    expect(out).toHaveLength(40);
    expect(out[0].content).toBe('20');
  });

  it('drops the oldest turns until the total fits', () => {
    const h = Array.from({ length: 5 }, (_, i) => ({ role: 'assistant', content: String(i).repeat(30_000) }));
    const out = trimHistory(h);
    expect(out.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(90_000);
    expect(out[out.length - 1].content[0]).toBe('4');
  });

  it('returns [] for non-arrays', () => {
    expect(trimHistory({ $ne: null })).toEqual([]);
  });
});
