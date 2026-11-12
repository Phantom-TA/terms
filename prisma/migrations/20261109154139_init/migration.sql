-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('SUPPLIER', 'CLIENT');

-- CreateEnum
CREATE TYPE "DealState" AS ENUM ('SUGGESTED', 'APPROVED', 'SENT', 'COUNTERED', 'NEEDS_OWNER', 'AGREED', 'INVOICE_UPDATED', 'AWAITING_PAYMENT', 'PAID', 'PARTIALLY_PAID', 'DECLINED', 'EXPIRED', 'WITHDRAWN', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('NONE', 'REMINDER', 'PARTIAL_PAYMENT', 'EARLY_DISCOUNT', 'NEGOTIATE');

-- CreateEnum
CREATE TYPE "PlanItemRank" AS ENUM ('PRIMARY', 'BACKUP');

-- CreateEnum
CREATE TYPE "PlanReasonCode" AS ENUM ('CHEAPEST_COVER', 'PARTIAL_TO_FIT_GAP', 'CLIENT_EARLY_PAY_CAP', 'REMINDER_OVERDUE', 'REMINDER_DUE_BEFORE_DEADLINE', 'DO_NOT_CONTACT', 'OVERDUE_NO_DISCOUNT', 'NOT_NEEDED', 'BACKUP', 'OWNER_EDIT', 'OWNER_EXCLUDED', 'ALREADY_PAID');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'MET', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'MET', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('PLAN', 'COUNTER_OVER_PLAN', 'BACKUP_OVER_CEILING', 'CLIENT_PAYMENT');

-- CreateEnum
CREATE TYPE "ApprovalRequestedFrom" AS ENUM ('OWNER', 'CLIENT_HUMAN');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('OWNER', 'SUPPLIER_AGENT', 'CLIENT_AGENT', 'CLIENT_HUMAN', 'SYSTEM', 'PAYPAL');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('OFFER', 'COUNTER', 'ACCEPT', 'DECLINE', 'WITHDRAW');

-- CreateEnum
CREATE TYPE "PayPalInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'SCHEDULED', 'UNPAID', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashEventKind" AS ENUM ('PAYROLL', 'RENT', 'CONTRACTOR', 'SUBSCRIPTION', 'TAX', 'INVOICE_PAYMENT', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CashEventSource" AS ENUM ('PAYPAL_TXN', 'CONFIRMED_RECURRING');

-- CreateEnum
CREATE TYPE "BalanceSource" AS ENUM ('PAYPAL_BALANCES', 'LEDGER');

-- CreateEnum
CREATE TYPE "Tone" AS ENUM ('FRIENDLY_BRIEF', 'FORMAL', 'WARM_DETAILED');

-- CreateEnum
CREATE TYPE "VaultStatus" AS ENUM ('NONE', 'PENDING', 'ACTIVE', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PAYER_ACTION_REQUIRED', 'APPROVED', 'CAPTURED', 'RECORDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('SESSION_STARTED', 'SYNC_COMPLETED', 'GOAL_PARSED', 'GOAL_UPDATED', 'FORECAST_COMPUTED', 'PLAN_CREATED', 'PLAN_ITEM_EDITED', 'PLAN_APPROVED', 'PLAN_CANCELLED', 'POLICY_CHECKED', 'NEGOTIATION_MESSAGE', 'DEAL_TRANSITION', 'APPROVAL_REQUESTED', 'APPROVAL_DECIDED', 'REMINDER_SENT', 'INVOICE_UPDATED', 'INVOICE_REISSUED', 'PAYMENT_RECORDED', 'ORDER_CREATED', 'ORDER_CAPTURED', 'VAULT_SETUP_STARTED', 'VAULT_TOKEN_CREATED', 'PAYPAL_REQUEST', 'PAYPAL_ERROR', 'WEBHOOK_VERIFIED', 'WEBHOOK_REJECTED', 'WEBHOOK_DUPLICATE', 'OFFER_PAGE_VIEWED', 'OFFER_REPLY', 'GOAL_MET', 'CLIENT_POLICY_UPDATED', 'SUPPLIER_POLICY_UPDATED', 'STUDIO_TURN');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('BUSINESS', 'INVOICE', 'GOAL', 'PLAN', 'PLAN_ITEM', 'DEAL', 'APPROVAL', 'WEBHOOK_EVENT', 'VAULT_TOKEN', 'PAYMENT', 'POLICY', 'SESSION');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL,
    "paypalEmail" TEXT,
    "paypalMerchantId" TEXT,
    "hasAgent" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPolicy" (
    "businessId" TEXT NOT NULL,
    "maxDiscountBps" INTEGER NOT NULL,
    "openingDiscountBps" INTEGER,
    "doNotContact" TEXT[],
    "bufferBps" INTEGER NOT NULL DEFAULT 500,
    "costCeilingCents" BIGINT NOT NULL,
    "tone" "Tone" NOT NULL DEFAULT 'FRIENDLY_BRIEF',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPolicy_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "ClientPolicy" (
    "businessId" TEXT NOT NULL,
    "hurdleBps" INTEGER NOT NULL,
    "targetBps" INTEGER NOT NULL,
    "cashBufferCents" BIGINT NOT NULL,
    "autoPayLimitCents" BIGINT NOT NULL,
    "earlyPayCapCents" BIGINT,
    "neverPayEarly" TEXT[],
    "cashOnHandCents" BIGINT NOT NULL,
    "cashAsOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPolicy_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "PayPalAccount" (
    "businessId" TEXT NOT NULL,
    "merchantId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "balanceCents" BIGINT,
    "balanceCurrency" TEXT NOT NULL DEFAULT 'USD',
    "balanceSource" "BalanceSource",
    "balanceAsOf" TIMESTAMP(3),
    "txnCoveredFrom" TIMESTAMP(3),
    "txnCoveredTo" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPalAccount_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "paypalInvoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "issueDate" DATE,
    "dueDate" DATE NOT NULL,
    "paypalStatus" "PayPalInvoiceStatus" NOT NULL,
    "amountPaidCents" BIGINT NOT NULL DEFAULT 0,
    "amountDueCents" BIGINT NOT NULL,
    "contactAllowed" BOOLEAN NOT NULL DEFAULT true,
    "paypalUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "paypalUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "kind" "CashEventKind" NOT NULL,
    "source" "CashEventSource" NOT NULL,
    "label" TEXT NOT NULL,
    "paypalTxnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "deadline" DATE NOT NULL,
    "maxDiscountBps" INTEGER NOT NULL,
    "openingDiscountBps" INTEGER NOT NULL,
    "doNotContactIds" TEXT[],
    "doNotContactEntries" JSONB NOT NULL DEFAULT '[]',
    "bufferBps" INTEGER NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
    "forecast" JSONB,
    "defaultedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "costCeilingCents" BIGINT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "metAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,
    "rank" "PlanItemRank" NOT NULL,
    "backupOrder" INTEGER,
    "discountBps" INTEGER,
    "amountEarlyCents" BIGINT,
    "payBy" DATE,
    "costCents" BIGINT NOT NULL DEFAULT 0,
    "committedIfAgreedCents" BIGINT NOT NULL DEFAULT 0,
    "reasonCode" "PlanReasonCode" NOT NULL,
    "reason" TEXT NOT NULL,
    "explanation" TEXT,
    "editedByOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "action" "ActionType" NOT NULL,
    "state" "DealState" NOT NULL DEFAULT 'SUGGESTED',
    "round" INTEGER NOT NULL DEFAULT 0,
    "currentTerms" JSONB,
    "agreedTerms" JSONB,
    "costCents" BIGINT NOT NULL DEFAULT 0,
    "committedCents" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "paypalInvoiceId" TEXT NOT NULL,
    "reissuedInvoiceId" TEXT,
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "invoicePaymentId" TEXT,
    "payerUrl" TEXT,
    "offerTokenHash" TEXT,
    "offerTokenUsedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealTransition" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromState" "DealState",
    "toState" "DealState" NOT NULL,
    "actor" "Actor" NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationMessage" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromParty" TEXT NOT NULL,
    "toParty" TEXT NOT NULL,
    "actor" "Actor" NOT NULL,
    "type" "MessageType" NOT NULL,
    "terms" JSONB,
    "impliedAnnualRate" TEXT,
    "payNowCents" BIGINT,
    "note" TEXT NOT NULL,
    "policyChecks" JSONB NOT NULL DEFAULT '[]',
    "round" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NegotiationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestedFrom" "ApprovalRequestedFrom" NOT NULL,
    "businessId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "planId" TEXT,
    "dealId" TEXT,
    "terms" JSONB,
    "paymentAmountCents" BIGINT,
    "costImpact" JSONB,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" "Actor",
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultToken" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "setupTokenId" TEXT,
    "paypalPaymentTokenId" TEXT,
    "payerEmail" TEXT,
    "status" "VaultStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "paypalOrderId" TEXT,
    "captureId" TEXT,
    "invoicePaymentId" TEXT,
    "amountCents" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "paypalEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" "Actor" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "subjectType" "SubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "businessIds" TEXT[],
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "paypalDebugId" TEXT,
    "paypalRequestId" TEXT,
    "webhookVerified" BOOLEAN,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" BIGSERIAL NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paypalInvoiceId_key" ON "Invoice"("paypalInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_supplierId_paypalStatus_idx" ON "Invoice"("supplierId", "paypalStatus");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_supplierId_number_key" ON "Invoice"("supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CashEvent_paypalTxnId_key" ON "CashEvent"("paypalTxnId");

-- CreateIndex
CREATE INDEX "CashEvent_businessId_date_idx" ON "CashEvent"("businessId", "date");

-- CreateIndex
CREATE INDEX "Goal_supplierId_status_idx" ON "Goal"("supplierId", "status");

-- CreateIndex
CREATE INDEX "Plan_goalId_idx" ON "Plan"("goalId");

-- CreateIndex
CREATE INDEX "PlanItem_planId_rank_idx" ON "PlanItem"("planId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_planItemId_key" ON "Deal"("planItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_offerTokenHash_key" ON "Deal"("offerTokenHash");

-- CreateIndex
CREATE INDEX "Deal_planId_state_idx" ON "Deal"("planId", "state");

-- CreateIndex
CREATE INDEX "Deal_clientId_state_idx" ON "Deal"("clientId", "state");

-- CreateIndex
CREATE INDEX "DealTransition_dealId_at_idx" ON "DealTransition"("dealId", "at");

-- CreateIndex
CREATE INDEX "NegotiationMessage_dealId_createdAt_idx" ON "NegotiationMessage"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_businessId_decision_idx" ON "Approval"("businessId", "decision");

-- CreateIndex
CREATE INDEX "Approval_dealId_idx" ON "Approval"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultToken_setupTokenId_key" ON "VaultToken"("setupTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultToken_paypalPaymentTokenId_key" ON "VaultToken"("paypalPaymentTokenId");

-- CreateIndex
CREATE INDEX "VaultToken_clientId_status_idx" ON "VaultToken"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_paypalOrderId_key" ON "PaymentRecord"("paypalOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_captureId_key" ON "PaymentRecord"("captureId");

-- CreateIndex
CREATE INDEX "PaymentRecord_dealId_idx" ON "PaymentRecord"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_paypalEventId_key" ON "WebhookEvent"("paypalEventId");

-- CreateIndex
CREATE INDEX "WebhookEvent_type_receivedAt_idx" ON "WebhookEvent"("type", "receivedAt");

-- CreateIndex
CREATE INDEX "AuditLog_subjectType_subjectId_idx" ON "AuditLog"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_businessId_idx" ON "Session"("businessId");

-- CreateIndex
CREATE INDEX "EventLog_businessId_id_idx" ON "EventLog"("businessId", "id");

-- AddForeignKey
ALTER TABLE "SupplierPolicy" ADD CONSTRAINT "SupplierPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPolicy" ADD CONSTRAINT "ClientPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayPalAccount" ADD CONSTRAINT "PayPalAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashEvent" ADD CONSTRAINT "CashEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealTransition" ADD CONSTRAINT "DealTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationMessage" ADD CONSTRAINT "NegotiationMessage_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultToken" ADD CONSTRAINT "VaultToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
