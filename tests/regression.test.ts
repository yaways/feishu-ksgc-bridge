import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

import { translateEvent } from '../src/agent/ksgc/stream-json';
import { formatRelTime, listRecentSessions } from '../src/session/history';

// ─── stream-json: translateEvent ─────────────────────────────────────────

describe('translateEvent (KSGC stream-json)', () => {
  it('translates init event to system event', () => {
    const events = [...translateEvent({
      type: 'init',
      session_id: 'abc123-def456',
      model: 'gemini-2.5-pro',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'system',
      sessionId: 'abc123-def456',
      model: 'gemini-2.5-pro',
    });
  });

  it('translates assistant message to text event', () => {
    const events = [...translateEvent({
      type: 'message',
      role: 'assistant',
      content: 'Hello, world!',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'text', delta: 'Hello, world!' });
  });

  it('ignores user message events (not forwarded to card)', () => {
    const events = [...translateEvent({
      type: 'message',
      role: 'user',
      content: 'Hi',
    })];
    expect(events).toHaveLength(0);
  });

  it('ignores empty assistant content', () => {
    const events = [...translateEvent({
      type: 'message',
      role: 'assistant',
      content: '',
    })];
    expect(events).toHaveLength(0);
  });

  it('translates tool_use event', () => {
    const events = [...translateEvent({
      type: 'tool_use',
      tool_name: 'Bash',
      tool_id: 'tu_001',
      parameters: { command: 'ls -la' },
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool_use',
      id: 'tu_001',
      name: 'Bash',
      input: { command: 'ls -la' },
    });
  });

  it('translates tool_result event (success)', () => {
    const events = [...translateEvent({
      type: 'tool_result',
      tool_id: 'tu_001',
      status: 'success',
      output: 'file1.txt\nfile2.txt',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool_result',
      id: 'tu_001',
      output: 'file1.txt\nfile2.txt',
      isError: false,
    });
  });

  it('translates tool_result event (error)', () => {
    const events = [...translateEvent({
      type: 'tool_result',
      tool_id: 'tu_002',
      status: 'error',
      output: 'command not found',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool_result',
      id: 'tu_002',
      output: 'command not found',
      isError: true,
    });
  });

  it('translates error event', () => {
    const events = [...translateEvent({
      type: 'error',
      message: 'API rate limit exceeded',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'API rate limit exceeded',
    });
  });

  it('translates error event with default message', () => {
    const events = [...translateEvent({ type: 'error' })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'unknown ksgc error',
    });
  });

  it('translates result event with usage', () => {
    const events = [...translateEvent({
      type: 'result',
      status: 'success',
      session_id: 'sess-123',
      stats: {
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
      },
    })];
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: 'usage',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(events[1]).toEqual({
      type: 'done',
      sessionId: 'sess-123',
    });
  });

  it('translates result event without stats', () => {
    const events = [...translateEvent({
      type: 'result',
      status: 'success',
      session_id: 'sess-456',
    })];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'done',
      sessionId: 'sess-456',
    });
  });

  it('handles null/undefined input gracefully', () => {
    expect([...translateEvent(null)]).toHaveLength(0);
    expect([...translateEvent(undefined)]).toHaveLength(0);
    expect([...translateEvent({})]).toHaveLength(0);
    expect([...translateEvent('string')]).toHaveLength(0);
  });

  it('handles unknown event type gracefully', () => {
    const events = [...translateEvent({ type: 'unknown_type' })];
    expect(events).toHaveLength(0);
  });
});

// ─── session/history: formatRelTime ──────────────────────────────────────

describe('formatRelTime', () => {
  it('returns 刚刚 for < 1 minute', () => {
    expect(formatRelTime(Date.now() - 30_000)).toBe('刚刚');
  });

  it('returns N 分钟前 for minutes', () => {
    expect(formatRelTime(Date.now() - 5 * 60_000)).toBe('5 分钟前');
  });

  it('returns N 小时前 for hours', () => {
    expect(formatRelTime(Date.now() - 3 * 3_600_000)).toBe('3 小时前');
  });

  it('returns 昨天 for 1 day ago', () => {
    expect(formatRelTime(Date.now() - 25 * 3_600_000)).toBe('昨天');
  });

  it('returns N 天前 for days', () => {
    expect(formatRelTime(Date.now() - 5 * 86_400_000)).toBe('5 天前');
  });

  it('returns N 个月前 for months', () => {
    expect(formatRelTime(Date.now() - 90 * 86_400_000)).toBe('3 个月前');
  });
});

// ─── session/history: listRecentSessions (parseListSessions) ─────────────

describe('listRecentSessions', () => {
  it('returns empty array when ksgc is not available', async () => {
    // This test runs in an environment where ksgc may or may not be installed.
    // If ksgc is not installed, it should return [] gracefully.
    const sessions = await listRecentSessions('/nonexistent/path', 5);
    expect(Array.isArray(sessions)).toBe(true);
  });
});

// ─── No Claude/Anthropic references in source ────────────────────────────

describe('no Claude/Anthropic references in source code', () => {
  it('has no claude references in src/*.ts', async () => {
    const result = execSync(
      'grep -ri "\\\\bclaude\\\\b\\|__claude_cb\\|CLAUDE_CALLBACK\\|forwardToClaude\\|Anthropic\\|\\.claude/" src/ --include="*.ts" || true',
      { encoding: 'utf8', cwd: projectRoot },
    );
    expect(result.trim()).toBe('');
  });

  it('uses __ksgc_cb marker in dispatcher', async () => {
    const dispatcher = readFileSync(
      join(projectRoot, 'src/card/dispatcher.ts'),
      'utf8',
    );
    expect(dispatcher).toContain('__ksgc_cb');
    expect(dispatcher).toContain('AGENT_CALLBACK_MARKER');
    expect(dispatcher).toContain('forwardToAgent');
    expect(dispatcher).not.toContain('__claude_cb');
    expect(dispatcher).not.toContain('CLAUDE_CALLBACK_MARKER');
    expect(dispatcher).not.toContain('forwardToClaude');
  });

  it('uses __ksgc_cb in BRIDGE_SYSTEM_PROMPT', async () => {
    const adapter = readFileSync(
      join(projectRoot, 'src/agent/ksgc/adapter.ts'),
      'utf8',
    );
    expect(adapter).toContain('__ksgc_cb');
    expect(adapter).toContain('lark-ksgc-bridge');
    expect(adapter).not.toContain('__claude_cb');
    expect(adapter).not.toContain('lark-channel-bridge');
  });

  it('uses ~/.lark-ksgc/ as data directory', async () => {
    const paths = readFileSync(
      join(projectRoot, 'src/config/paths.ts'),
      'utf8',
    );
    expect(paths).toContain('.lark-ksgc');
    expect(paths).not.toContain('.lark-channel');
  });
});
