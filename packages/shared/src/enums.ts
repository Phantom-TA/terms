/**
 * Every enum shared by the API and the web app. Each is a zod enum so it validates at runtime and
 * gives a string-literal type; use `DealState.enum.SENT` for a constant and `DealState.options`
 * for the full list.
 */
import { z } from 'zod';

/** Deal lifecycle (CONTEXT.md, "Deal states"), plus REMOVED for a row the owner drops before approval. */
export const DealState = z.enum([
  'SUGGESTED',
  'APPROVED',
  'SENT',
  'COUNTERED',
  'NEEDS_OWNER',
  'AGREED',
  'INVOICE_UPDATED',
  'AWAITING_PAYMENT',
  'PAID',
  'PARTIALLY_PAID',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
  'FAILED',
  'REMOVED',
]);
export type DealState = z.infer<typeof DealState>;

/** One action per invoice in a plan (CONTEXT.md, "Action menu"). */
export const ActionType = z.enum([
  'NONE',
  'REMINDER',
  'PARTIAL_PAYMENT',
  'EARLY_DISCOUNT',
  'NEGOTIATE',
]);
export type ActionType = z.infer<typeof ActionType>;

export const PlanItemRank = z.enum(['PRIMARY', 'BACKUP']);
export type PlanItemRank = z.infer<typeof PlanItemRank>;

/** Deterministic reason the planner chose a row's action; the LLM explanation sits beside it. */
export const PlanReasonCode = z.enum([
  'CHEAPEST_COVER',
  'PARTIAL_TO_FIT_GAP',
  'CLIENT_EARLY_PAY_CAP',
  'REMINDER_OVERDUE',
  'REMINDER_DUE_BEFORE_DEADLINE',
  'DO_NOT_CONTACT',
  'OVERDUE_NO_DISCOUNT',
  'NOT_NEEDED',
  'BACKUP',
  'OWNER_EDIT',
  'OWNER_EXCLUDED',
  'ALREADY_PAID',
]);
export type PlanReasonCode = z.infer<typeof PlanReasonCode>;

export const PlanStatus = z.enum(['DRAFT', 'APPROVED', 'MET', 'CANCELLED']);
export type PlanStatus = z.infer<typeof PlanStatus>;

/** DRAFT: parsed, awaiting the owner's confirmation; PLANNED: a draft plan exists; ACTIVE: plan approved. */
export const GoalStatus = z.enum(['DRAFT', 'PLANNED', 'ACTIVE', 'MET', 'CANCELLED']);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** What an approval is about. */
export const ApprovalType = z.enum([
  /** The owner approves the whole plan and its cost ceiling. */
  'PLAN',
  /** A counter-offer that raises plan cost above the ceiling or breaks the plan's shape (NEEDS_OWNER). */
  'COUNTER_OVER_PLAN',
  /** A backup offer that would take total cost above the ceiling. */
  'BACKUP_OVER_CEILING',
  /** A payment above a client agent's auto-pay limit, approved by a person at the client in PayPal. */
  'CLIENT_PAYMENT',
]);
export type ApprovalType = z.infer<typeof ApprovalType>;

export const ApprovalRequestedFrom = z.enum(['OWNER', 'CLIENT_HUMAN']);
export type ApprovalRequestedFrom = z.infer<typeof ApprovalRequestedFrom>;

export const ApprovalDecision = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'WITHDRAWN']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

/** Who performed a step, for the audit trail and deal history. */
export const Actor = z.enum([
  'OWNER',
  'SUPPLIER_AGENT',
  'CLIENT_AGENT',
  'CLIENT_HUMAN',
  'SYSTEM',
  'PAYPAL',
]);
export type Actor = z.infer<typeof Actor>;

export const MessageType = z.enum(['OFFER', 'COUNTER', 'ACCEPT', 'DECLINE', 'WITHDRAW']);
export type MessageType = z.infer<typeof MessageType>;

export const BusinessRole = z.enum(['SUPPLIER', 'CLIENT']);
export type BusinessRole = z.infer<typeof BusinessRole>;

/** PayPal Invoicing v2 invoice statuses. */
export const PayPalInvoiceStatus = z.enum([
  'DRAFT',
  'SENT',
  'SCHEDULED',
  'UNPAID',
  'PAYMENT_PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'MARKED_AS_PAID',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'MARKED_AS_REFUNDED',
]);
export type PayPalInvoiceStatus = z.infer<typeof PayPalInvoiceStatus>;

export const PayPalEnvironment = z.enum(['sandbox', 'live']);
export type PayPalEnvironment = z.infer<typeof PayPalEnvironment>;

/** PayPal webhook events Terms subscribes to. Confirmed in spike S3. */
export const PayPalWebhookEventType = z.enum([
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.UPDATED',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'CHECKOUT.ORDER.APPROVED',
  'CHECKOUT.ORDER.COMPLETED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.PENDING',
  'VAULT.PAYMENT-TOKEN.CREATED',
  'VAULT.PAYMENT-TOKEN.DELETED',
]);
export type PayPalWebhookEventType = z.infer<typeof PayPalWebhookEventType>;

export const CashDirection = z.enum(['IN', 'OUT']);
export type CashDirection = z.infer<typeof CashDirection>;

export const CashEventKind = z.enum([
  'PAYROLL',
  'RENT',
  'CONTRACTOR',
  'SUBSCRIPTION',
  'TAX',
  'INVOICE_PAYMENT',
  'TRANSFER',
  'OTHER',
]);
export type CashEventKind = z.infer<typeof CashEventKind>;

/** PAYPAL_TXN: a real PayPal transaction; CONFIRMED_RECURRING: a recurring flow the owner confirmed. */
export const CashEventSource = z.enum(['PAYPAL_TXN', 'CONFIRMED_RECURRING']);
export type CashEventSource = z.infer<typeof CashEventSource>;

/** Where the current balance came from: PayPal's Balances API, or Terms' ledger of verified transactions. */
export const BalanceSource = z.enum(['PAYPAL_BALANCES', 'LEDGER']);
export type BalanceSource = z.infer<typeof BalanceSource>;

/** Policy rules checked in code before any PayPal call (CONTEXT.md, "Guardrails"). */
export const PolicyRule = z.enum([
  // supplier (owner) side
  'maxDiscount',
  'doNotContact',
  'costCeiling',
  'overdueNoDiscount',
  'amountWithinInvoice',
  'payByBeforeDue',
  'roundLimit',
  'offerExpiry',
  // client side
  'hurdleRate',
  'cashBuffer',
  'autoPayLimit',
  'earlyPayCap',
  'neverPayEarly',
]);
export type PolicyRule = z.infer<typeof PolicyRule>;

/** pass: allowed; blocked: not allowed; needs_approval: allowed only after a human approves. */
export const PolicyResult = z.enum(['pass', 'blocked', 'needs_approval']);
export type PolicyResult = z.infer<typeof PolicyResult>;

/** The owner's preferred tone for drafted messages (LLM drafting only). */
export const Tone = z.enum(['FRIENDLY_BRIEF', 'FORMAL', 'WARM_DETAILED']);
export type Tone = z.infer<typeof Tone>;

/** Saved PayPal payment method status for a client agent. */
export const VaultStatus = z.enum(['NONE', 'PENDING', 'ACTIVE', 'FAILED', 'REVOKED']);
export type VaultStatus = z.infer<typeof VaultStatus>;

/** Audit trail action names. */
export const AuditAction = z.enum([
  'SESSION_STARTED',
  'SYNC_COMPLETED',
  'GOAL_PARSED',
  'GOAL_UPDATED',
  'FORECAST_COMPUTED',
  'PLAN_CREATED',
  'PLAN_ITEM_EDITED',
  'PLAN_APPROVED',
  'PLAN_CANCELLED',
  'POLICY_CHECKED',
  'NEGOTIATION_MESSAGE',
  'DEAL_TRANSITION',
  'APPROVAL_REQUESTED',
  'APPROVAL_DECIDED',
  'REMINDER_SENT',
  'INVOICE_UPDATED',
  'INVOICE_REISSUED',
  'PAYMENT_RECORDED',
  'ORDER_CREATED',
  'ORDER_CAPTURED',
  'VAULT_SETUP_STARTED',
  'VAULT_TOKEN_CREATED',
  'PAYPAL_REQUEST',
  'PAYPAL_ERROR',
  'WEBHOOK_VERIFIED',
  'WEBHOOK_REJECTED',
  'WEBHOOK_DUPLICATE',
  'OFFER_PAGE_VIEWED',
  'OFFER_REPLY',
  'GOAL_MET',
  'CLIENT_POLICY_UPDATED',
  'SUPPLIER_POLICY_UPDATED',
  'STUDIO_TURN',
]);
export type AuditAction = z.infer<typeof AuditAction>;

/** Kinds of records an audit entry or approval can point at. */
export const SubjectType = z.enum([
  'BUSINESS',
  'INVOICE',
  'GOAL',
  'PLAN',
  'PLAN_ITEM',
  'DEAL',
  'APPROVAL',
  'WEBHOOK_EVENT',
  'VAULT_TOKEN',
  'PAYMENT',
  'POLICY',
  'SESSION',
]);
export type SubjectType = z.infer<typeof SubjectType>;
