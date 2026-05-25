import type { AgentEvent } from '../types';

/**
 * Raw event shapes emitted by KSGC's `--output-format stream-json`.
 *
 * Each line on stdout is a JSON object; the `type` field discriminates
 * between the different event kinds.  Based on empirical testing of
 * `ksgc -p "…" --output-format stream-json`.
 */
interface KsgcInitEvent {
  type: 'init';
  timestamp?: string;
  session_id?: string;
  model?: string;
}

interface KsgcMessageEvent {
  type: 'message';
  timestamp?: string;
  role: 'user' | 'assistant';
  content: string;
  delta?: boolean;
}

interface KsgcToolUseEvent {
  type: 'tool_use';
  timestamp?: string;
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

interface KsgcToolResultEvent {
  type: 'tool_result';
  timestamp?: string;
  tool_id: string;
  status: 'success' | 'error';
  output: string;
}

interface KsgcErrorEvent {
  type: 'error';
  timestamp?: string;
  message?: string;
}

interface KsgcResultEvent {
  type: 'result';
  timestamp?: string;
  status: 'success' | 'error';
  session_id?: string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
    tool_calls?: number;
    models?: Record<string, {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      cached?: number;
      input?: number;
    }>;
  };
}

type KsgcRawEvent =
  | KsgcInitEvent
  | KsgcMessageEvent
  | KsgcToolUseEvent
  | KsgcToolResultEvent
  | KsgcErrorEvent
  | KsgcResultEvent;

export function* translateEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as KsgcRawEvent;

  switch (evt.type) {
    case 'init': {
      yield {
        type: 'system',
        sessionId: evt.session_id,
        model: evt.model,
      };
      return;
    }

    case 'message': {
      if (evt.role === 'assistant' && typeof evt.content === 'string' && evt.content) {
        yield { type: 'text', delta: evt.content };
      }
      return;
    }

    case 'tool_use': {
      yield {
        type: 'tool_use',
        id: evt.tool_id,
        name: evt.tool_name,
        input: evt.parameters,
      };
      return;
    }

    case 'tool_result': {
      yield {
        type: 'tool_result',
        id: evt.tool_id,
        output: typeof evt.output === 'string' ? evt.output : JSON.stringify(evt.output),
        isError: evt.status !== 'success',
      };
      return;
    }

    case 'error': {
      yield {
        type: 'error',
        message: evt.message ?? 'unknown ksgc error',
      };
      return;
    }

    case 'result': {
      if (evt.stats) {
        yield {
          type: 'usage',
          inputTokens: evt.stats.input_tokens,
          outputTokens: evt.stats.output_tokens,
        };
      }
      yield { type: 'done', sessionId: evt.session_id };
      return;
    }
  }
}
