/**
 * Goals: the owner's sentence becomes a DRAFT goal for confirmation (CONTEXT.md, "How it works"
 * step 2). Fields the sentence leaves out come from the owner's standing policy and are reported
 * in `defaultedFields`; the owner can edit any field before planning.
 */
import {
  addDays,
  bpsToPercent,
  defaultOpeningBps,
  formatMoney,
  type Goal as GoalView,
  GoalForecast,
  isoDateInTimeZone,
  percentToBps,
  toCents,
  type UpdateGoalRequest,
} from '@terms/shared';
import { z } from 'zod';
import { type AuditLogger } from '../audit.js';
import { type Db, type DbOrTx } from '../db.js';
import { AppError, conflict, notFound } from '../errors.js';
import { type Goal, type Prisma } from '../generated/prisma/client.js';
import { dateToIso, isoToDate, money } from '../mappers.js';
import { targetFor } from '../planner/planner.js';
import { matchClients, parseGoalText } from './goal-parser.js';

/** When the sentence names no deadline, plan for a week ahead (reported as defaulted). */
export const DEFAULT_DEADLINE_DAYS = 7;
/** Buffer when neither the sentence nor the policy sets one (CONTEXT.md: 5% of the gap). */
export const DEFAULT_BUFFER_BPS = 500;

const DncEntries = z.array(
  z.object({
    name: z.string(),
    businessId: z.string().nullable(),
    matchedName: z.string().nullable(),
  }),
);
type Defaulted = GoalView['defaultedFields'][number];

export function toGoalView(goal: Goal): GoalView {
  const { target } = targetFor(goal.amountCents, goal.bufferBps);
  const forecast = GoalForecast.safeParse(goal.forecast);
  const entries = DncEntries.safeParse(goal.doNotContactEntries);
  return {
    id: goal.id,
    rawText: goal.rawText,
    amount: money(goal.amountCents),
    deadline: dateToIso(goal.deadline),
    maxDiscountPct: bpsToPercent(goal.maxDiscountBps),
    openingDiscountPct: bpsToPercent(goal.openingDiscountBps),
    doNotContact: entries.success ? entries.data : [],
    bufferPct: bpsToPercent(goal.bufferBps),
    target: money(target),
    status: goal.status,
    forecast: forecast.success ? forecast.data : null,
    defaultedFields: goal.defaultedFields.filter((f): f is Defaulted =>
      ['maxDiscountPct', 'bufferPct', 'doNotContact', 'deadline'].includes(f),
    ),
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export class GoalService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async supplierContext(db: DbOrTx, supplierId: string) {
    const supplier = await db.business.findUniqueOrThrow({
      where: { id: supplierId },
      include: { supplierPolicy: true },
    });
    const clients = await db.business.findMany({
      where: { role: 'CLIENT' },
      select: { id: true, name: true },
    });
    return { supplier, policy: supplier.supplierPolicy, clients };
  }

  /** Parses the owner's sentence into a DRAFT goal. */
  async createFromText(supplierId: string, text: string): Promise<GoalView> {
    const { supplier, policy, clients } = await this.supplierContext(this.db, supplierId);
    const today = isoDateInTimeZone(this.now(), supplier.timeZone);
    const parsed = parseGoalText(text, today);
    if (parsed.amount === null || parsed.amount <= 0n) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Say how much you need, for example "$6,200 by Friday"',
        {
          issues: [{ path: 'text', message: 'No amount found' }],
        },
      );
    }
    if (parsed.deadline !== null && parsed.deadline < today) {
      throw new AppError('VALIDATION_FAILED', 'The deadline is in the past', {
        issues: [{ path: 'text', message: `Deadline ${parsed.deadline} is before today` }],
      });
    }
    const defaulted: Defaulted[] = [];
    const maxDiscountBps = parsed.maxDiscountBps ?? policy?.maxDiscountBps ?? null;
    if (maxDiscountBps === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Say the most you will offer, for example "max 1.2%"',
        {
          issues: [{ path: 'text', message: 'No maximum discount found and no policy' }],
        },
      );
    }
    if (parsed.maxDiscountBps === null) defaulted.push('maxDiscountPct');
    const bufferBps = parsed.bufferBps ?? policy?.bufferBps ?? DEFAULT_BUFFER_BPS;
    if (parsed.bufferBps === null) defaulted.push('bufferPct');
    const deadline = parsed.deadline ?? addDays(today, DEFAULT_DEADLINE_DAYS);
    if (parsed.deadline === null) defaulted.push('deadline');
    const entries = matchClients(parsed.doNotContactNames, clients);
    if (entries.length === 0) defaulted.push('doNotContact');
    const doNotContactIds = [
      ...new Set([
        ...entries.flatMap((e) => (e.businessId === null ? [] : [e.businessId])),
        ...(parsed.doNotContactNames.length === 0 ? (policy?.doNotContact ?? []) : []),
      ]),
    ];
    const openingDiscountBps = Math.min(
      policy?.openingDiscountBps ?? defaultOpeningBps(maxDiscountBps),
      defaultOpeningBps(maxDiscountBps),
    );

    const goal = await this.db.goal.create({
      data: {
        supplierId,
        rawText: text,
        amountCents: parsed.amount,
        deadline: isoToDate(deadline),
        maxDiscountBps,
        openingDiscountBps,
        doNotContactIds,
        doNotContactEntries: entries,
        bufferBps,
        defaultedFields: defaulted,
      },
    });
    await this.audit.write(this.db, {
      actor: 'SYSTEM',
      action: 'GOAL_PARSED',
      subjectType: 'GOAL',
      subjectId: goal.id,
      businessIds: [supplierId],
      summary: `Goal: ${formatMoney(parsed.amount)} by ${deadline}, max ${bpsToPercent(maxDiscountBps)}%${doNotContactIds.length > 0 ? `, ${String(doNotContactIds.length)} protected` : ''}`,
      details: {
        parser: 'rules',
        defaulted,
        unmatched: entries.filter((e) => e.businessId === null).map((e) => e.name),
      },
    });
    return toGoalView(goal);
  }

  async get(goalId: string, supplierId: string, db: DbOrTx = this.db): Promise<Goal> {
    const goal = await db.goal.findUnique({ where: { id: goalId } });
    if (goal?.supplierId !== supplierId) throw notFound('Goal');
    return goal;
  }

  /** The owner edits parsed fields. Editing a planned goal discards its draft plan. */
  async update(goalId: string, supplierId: string, patch: UpdateGoalRequest): Promise<GoalView> {
    return this.db.$transaction(async (tx) => {
      const goal = await this.get(goalId, supplierId, tx);
      if (goal.status !== 'DRAFT' && goal.status !== 'PLANNED') {
        throw conflict(`Goal is ${goal.status.toLowerCase()}; start a new goal instead`);
      }
      const maxDiscountBps =
        patch.maxDiscountPct === undefined
          ? goal.maxDiscountBps
          : percentToBps(patch.maxDiscountPct);
      const openingDiscountBps =
        patch.openingDiscountPct === undefined
          ? Math.min(goal.openingDiscountBps, maxDiscountBps)
          : percentToBps(patch.openingDiscountPct);
      if (openingDiscountBps > maxDiscountBps) {
        throw new AppError('VALIDATION_FAILED', 'The opening discount cannot exceed the maximum', {
          issues: [{ path: 'openingDiscountPct', message: 'Above the maximum' }],
        });
      }
      const today = isoDateInTimeZone(
        this.now(),
        (await tx.business.findUniqueOrThrow({ where: { id: supplierId } })).timeZone,
      );
      if (patch.deadline !== undefined && patch.deadline < today) {
        throw new AppError('VALIDATION_FAILED', 'The deadline is in the past', {
          issues: [{ path: 'deadline', message: 'Before today' }],
        });
      }
      let doNotContact: Pick<Prisma.GoalUpdateInput, 'doNotContactIds' | 'doNotContactEntries'> =
        {};
      if (patch.doNotContactIds !== undefined) {
        const ids = [...new Set(patch.doNotContactIds)];
        const clients = await tx.business.findMany({ where: { id: { in: ids }, role: 'CLIENT' } });
        if (clients.length !== ids.length) {
          throw new AppError('VALIDATION_FAILED', 'Do-not-contact must list client businesses', {
            issues: [{ path: 'doNotContactIds', message: 'Unknown client' }],
          });
        }
        doNotContact = {
          doNotContactIds: ids,
          doNotContactEntries: clients.map((c) => ({
            name: c.name,
            businessId: c.id,
            matchedName: c.name,
          })),
        };
      }
      const changed = Object.keys(patch);
      const updated = await tx.goal.update({
        where: { id: goalId },
        data: {
          ...(patch.amount === undefined ? {} : { amountCents: toCents(patch.amount) }),
          ...(patch.deadline === undefined ? {} : { deadline: isoToDate(patch.deadline) }),
          ...(patch.bufferPct === undefined ? {} : { bufferBps: percentToBps(patch.bufferPct) }),
          maxDiscountBps,
          openingDiscountBps,
          ...doNotContact,
          status: 'DRAFT',
          // A field the owner set is no longer a default.
          defaultedFields: goal.defaultedFields.filter(
            (f) =>
              !(f === 'doNotContact' ? changed.includes('doNotContactIds') : changed.includes(f)),
          ),
        },
      });
      await tx.plan.updateMany({
        where: { goalId, status: 'DRAFT' },
        data: { status: 'CANCELLED' },
      });
      await this.audit.write(tx, {
        actor: 'OWNER',
        action: 'GOAL_UPDATED',
        subjectType: 'GOAL',
        subjectId: goalId,
        businessIds: [supplierId],
        summary: `Goal edited: ${changed.join(', ')}`,
        details: { ...patch },
      });
      return toGoalView(updated);
    });
  }

  /** The latest goal still in play, and its latest plan id. */
  async current(supplierId: string): Promise<{ goal: Goal; planId: string | null } | null> {
    const goal = await this.db.goal.findFirst({
      where: { supplierId, status: { in: ['DRAFT', 'PLANNED', 'ACTIVE', 'MET'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (goal === null) return null;
    const plan = await this.db.plan.findFirst({
      where: { goalId: goal.id, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return { goal, planId: plan?.id ?? null };
  }
}
