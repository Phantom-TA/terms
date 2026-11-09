import { z } from 'zod';
import { Tone } from '../enums.js';
import { percentToBps } from '../money.js';
import { BusinessRef, Id, IsoDateTime, MoneyAmount, Percent } from './common.js';

/** The owner's standing policy (CONTEXT.md, "Owner (supplier) policy"). Goals can override per goal. */
export const SupplierPolicyView = z.object({
  maxDiscountPct: Percent,
  /** Null means the default: two-thirds of the maximum, rounded down to 0.1%. */
  openingDiscountPct: Percent.nullable(),
  doNotContact: z.array(BusinessRef),
  bufferPct: Percent,
  costCeiling: MoneyAmount,
  tone: Tone,
  updatedAt: IsoDateTime,
});
export type SupplierPolicyView = z.infer<typeof SupplierPolicyView>;

/** GET /api/supplier/policy response. */
export const SupplierPolicyResponse = z.object({ policy: SupplierPolicyView });
export type SupplierPolicyResponse = z.infer<typeof SupplierPolicyResponse>;

/** PUT /api/supplier/policy — replaces the owner's policy. Owner only. */
export const PutSupplierPolicyRequest = z
  .strictObject({
    maxDiscountPct: Percent,
    openingDiscountPct: Percent.nullable(),
    doNotContactIds: z.array(Id).max(100),
    bufferPct: Percent,
    costCeiling: MoneyAmount,
    tone: Tone,
  })
  .refine(
    (v) =>
      v.openingDiscountPct === null ||
      percentToBps(v.openingDiscountPct) <= percentToBps(v.maxDiscountPct),
    { message: 'The opening discount cannot exceed the maximum', path: ['openingDiscountPct'] },
  );
export type PutSupplierPolicyRequest = z.infer<typeof PutSupplierPolicyRequest>;

/** A client agent's policy (CONTEXT.md, "Client policy"). */
export const ClientPolicyView = z.object({
  /** Accept offers returning at least this much a year. */
  hurdleRatePct: Percent,
  /** Counter at the discount that reaches this annual rate when an offer is below the hurdle. */
  targetRatePct: Percent,
  /** Never pay early if cash would fall below this. */
  cashBuffer: MoneyAmount,
  /** Above this payment a person approves in PayPal. */
  autoPayLimit: MoneyAmount,
  /** Above this early amount per deal, counter with a smaller partial amount. Null: no cap. */
  earlyPayCapPerDeal: MoneyAmount.nullable(),
  /** Suppliers never paid early. */
  neverPayEarly: z.array(BusinessRef),
  updatedAt: IsoDateTime,
});
export type ClientPolicyView = z.infer<typeof ClientPolicyView>;

/** GET /api/client/policy response. */
export const ClientPolicyResponse = z.object({ policy: ClientPolicyView });
export type ClientPolicyResponse = z.infer<typeof ClientPolicyResponse>;

/** PUT /api/client/policy — replaces the client agent's policy. Client only. */
export const PutClientPolicyRequest = z
  .strictObject({
    hurdleRatePct: Percent,
    targetRatePct: Percent,
    cashBuffer: MoneyAmount,
    autoPayLimit: MoneyAmount,
    earlyPayCapPerDeal: MoneyAmount.nullable(),
    neverPayEarlyIds: z.array(Id).max(100),
  })
  .refine((v) => percentToBps(v.targetRatePct) >= percentToBps(v.hurdleRatePct), {
    message: 'The target rate must be at least the hurdle rate',
    path: ['targetRatePct'],
  });
export type PutClientPolicyRequest = z.infer<typeof PutClientPolicyRequest>;
