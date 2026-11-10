/** The AI roles, built once from a runner. Null when no AI is configured: callers fall back. */
import { type Logger } from '../logger.js';
import { AiGoalParser } from './goal-role.js';
import { AiMovers } from './negotiator-role.js';
import { AiNoteWriter } from './note-role.js';
import { AiReplyParser } from './reply-role.js';
import { type AiRunner } from './runner.js';

export interface AiServices {
  runner: AiRunner;
  goals: AiGoalParser;
  replies: AiReplyParser;
  /** The two negotiators; each falls back to the standard strategy on any problem. */
  movers: AiMovers;
  /** Writes the note on a negotiation message; the engine's plain note is the fallback. */
  notes: AiNoteWriter;
}

export function buildAiServices(runner: AiRunner | null, logger?: Logger): AiServices | null {
  if (runner === null) return null;
  return {
    runner,
    goals: new AiGoalParser(runner),
    replies: new AiReplyParser(runner),
    movers: new AiMovers(runner, (report) => {
      logger?.warn(report, 'AI negotiator fell back to the standard strategy');
    }),
    notes: new AiNoteWriter(runner, (why) => {
      logger?.warn({ why }, 'AI note writer fell back to the plain note');
    }),
  };
}
