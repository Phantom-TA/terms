/** The AI roles, built once from a runner. Null when no AI is configured: callers fall back. */
import { type Logger } from '../logger.js';
import { AiPlanExplainer } from './explainer-role.js';
import { AiGoalParser } from './goal-role.js';
import { AiFlowLabeller } from './labeller-role.js';
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
  /** Writes each plan row's explanation; a row without one shows the planner's reason. */
  explainer: AiPlanExplainer;
  /** Labels imported PayPal transactions for the cash history; never confirms a recurring flow. */
  labeller: AiFlowLabeller;
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
    explainer: new AiPlanExplainer(runner, (why) => {
      logger?.warn({ why }, 'AI plan explainer left a row to the planner reason');
    }),
    labeller: new AiFlowLabeller(runner, (why) => {
      logger?.warn({ why }, 'AI flow labeller left transactions with PayPal wording');
    }),
  };
}
