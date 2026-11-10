/** The AI roles, built once from a runner. Null when no AI is configured: callers fall back. */
import { AiGoalParser } from './goal-role.js';
import { AiReplyParser } from './reply-role.js';
import { type AiRunner } from './runner.js';

export interface AiServices {
  runner: AiRunner;
  goals: AiGoalParser;
  replies: AiReplyParser;
}

export function buildAiServices(runner: AiRunner | null): AiServices | null {
  if (runner === null) return null;
  return { runner, goals: new AiGoalParser(runner), replies: new AiReplyParser(runner) };
}
