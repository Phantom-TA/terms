/**
 * Fills in the plan rows' explanations in the background (CONTEXT.md: "the LLM explains each row").
 *
 * Creating or editing a plan never waits for a model: the rows appear at once with the planner's
 * own reason, and each explanation arrives when ready, announced with `plan.updated`. A row the
 * owner edits while its explanation is being written keeps no stale text: the write only lands if
 * the row is unchanged since it was read.
 */
import { type AiPlanExplainer } from '../ai/explainer-role.js';
import { type Db } from '../db.js';
import { type EventBus } from '../http/events.js';
import { type Logger } from '../logger.js';
import { dateToIso } from '../mappers.js';
import { type PlanService } from './plan-service.js';

/** Model calls in flight at once for one plan. */
const CONCURRENCY = 4;

export class PlanExplainer {
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Db,
    private readonly plans: PlanService,
    private readonly role: AiPlanExplainer,
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Starts explaining a plan's unexplained rows without waiting. */
  start(planId: string): void {
    const run = this.explainPlan(planId).catch((err: unknown) => {
      this.logger.error({ err, planId }, 'plan explanations failed');
    });
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
  }

  /** Resolves when every explanation started so far has finished (tests, graceful shutdown). */
  async settle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /** Explains every row that has no explanation yet. Returns how many were written. */
  async explainPlan(planId: string): Promise<number> {
    const plan = await this.db.plan.findUnique({
      where: { id: planId },
      select: { goal: { select: { supplierId: true, deadline: true } } },
    });
    if (plan === null) return 0;
    const supplierId = plan.goal.supplierId;
    const view = await this.plans.getView(planId, supplierId);
    const context = { gap: view.summary.gap, deadline: dateToIso(plan.goal.deadline) };
    const rows = await this.db.planItem.findMany({
      where: { planId, explanation: null },
      select: { id: true, updatedAt: true },
    });
    const pending = view.items.filter((i) => rows.some((r) => r.id === i.id));

    let written = 0;
    const queue = [...pending];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const text = await this.role.explain(item, context);
        if (text === null) continue;
        const loaded = rows.find((r) => r.id === item.id);
        if (loaded === undefined) continue;
        const res = await this.db.planItem.updateMany({
          where: { id: item.id, explanation: null, updatedAt: loaded.updatedAt },
          data: { explanation: text },
        });
        written += res.count;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    if (written > 0) {
      const fresh = await this.plans.getView(planId, supplierId);
      await this.events.publish([supplierId], {
        type: 'plan.updated',
        data: { planId, status: fresh.status, summary: fresh.summary },
      });
    }
    return written;
  }
}
