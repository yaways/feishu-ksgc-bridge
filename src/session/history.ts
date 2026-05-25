import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename } from 'node:path';

export interface SessionSummary {
  sessionId: string;
  mtime: number;
  preview: string;
  lineCount: number;
}

/**
 * Return the most recent `limit` sessions for the given cwd, newest first.
 *
 * Mirrors the original bridge's approach of reading KSGC's own session
 * storage . For KSGC,
 * we call `ksgc --list-sessions` which is KSGC's own session listing command.
 * This ensures we get the correct full UUIDs and previews that KSGC recognises.
 */
export async function listRecentSessions(cwd: string, limit = 5): Promise<SessionSummary[]> {
  try {
    const output = execSync('ksgc --list-sessions', {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return parseListSessions(output, limit);
  } catch (err) {
    // ksgc not installed or no sessions — return empty list
    return [];
  }
}

/**
 * Parse the output of `ksgc --list-sessions`:
 *
 *   Available sessions for this project (3):
 *     1. Adapt project to KSGC (Just now) [4865efe2-54d9-40ff-ae3b-008cb4833186]
 *     2. say hello in one word (2 hours ago) [143a8dd3-8e48-45df-b853-b3d427293c6d]
 *     3. list files (3 days ago) [c4aeffda-d1ba-45b9-8d82-b5f00d071e26]
 */
function parseListSessions(output: string, limit: number): SessionSummary[] {
  const lines = output.split('\n');
  const sessions: SessionSummary[] = [];

  for (const line of lines) {
    // Match: N. <preview> (<relTime>) [<sessionId>]
    const match = line.match(/^\s*\d+\.\s+(.+?)\s+\(([^)]+)\)\s+\[([0-9a-f-]{36})\]\s*$/i);
    if (!match) continue;

    const preview = match[1]!.trim();
    const relTime = match[2]!.trim();
    const sessionId = match[3]!.trim();

    sessions.push({
      sessionId,
      mtime: relTimeToTimestamp(relTime),
      preview: preview.slice(0, 80),
      lineCount: 0, // not available from --list-sessions
    });

    if (sessions.length >= limit) break;
  }

  return sessions;
}

/**
 * Convert a relative time string (from ksgc --list-sessions) to an
 * approximate timestamp. Used only for sorting — precision doesn't matter.
 */
function relTimeToTimestamp(relTime: string): number {
  const now = Date.now();
  const match = relTime.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (!match) return now;

  const n = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  switch (unit) {
    case 'second': return now - n * 1000;
    case 'minute': return now - n * 60_000;
    case 'hour': return now - n * 3_600_000;
    case 'day': return now - n * 86_400_000;
    case 'week': return now - n * 604_800_000;
    case 'month': return now - n * 2_592_000_000;
    case 'year': return now - n * 31_536_000_000;
    default: return now;
  }
}

/** Format a relative time like "3 小时前", "昨天", "3 天前". */
export function formatRelTime(mtime: number): string {
  const diffMs = Date.now() - mtime;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨天';
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  return `${mo} 个月前`;
}
