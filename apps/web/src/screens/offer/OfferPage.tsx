import {
  formatMoney,
  normalizeMoneyInput,
  OFFER_REPLY_MAX_LENGTH,
  type OfferReplyRequest,
  type OfferReplyResponse,
  type PublicOffer,
} from '@terms/shared';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toApiError } from '../../api/errors';
import { formatAnnualRate, formatDate, formatDateTime, formatPercent } from '../../lib/display';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Field, Input, Textarea } from '../../ui/Field';
import { PendingNotice } from '../../ui/PendingNotice';
import { LoadingRegion, Skeleton } from '../../ui/Skeleton';
import { usePublicOffer, useReplyToOffer } from './queries';

/** What happened, for an offer that can no longer be answered. */
const CLOSED: Readonly<Record<Exclude<PublicOffer['state'], 'OPEN'>, (o: PublicOffer) => string>> =
  {
    ACCEPTED: (o) =>
      `You accepted this offer. ${o.supplierName} will send the PayPal invoice to pay.`,
    COUNTERED: (o) => `You replied to this offer. ${o.supplierName} will get back to you.`,
    DECLINED: (o) =>
      `You said not now. Invoice ${o.invoiceNumber} stays due on ${formatDate(o.originalDueDate)}.`,
    EXPIRED: (o) =>
      `This offer has ended. Invoice ${o.invoiceNumber} stays due on ${formatDate(o.originalDueDate)}.`,
    WITHDRAWN: (o) =>
      `${o.supplierName} withdrew this offer. The invoice stays due on ${formatDate(o.originalDueDate)}.`,
    PAID: () => 'This invoice has been paid. Thank you.',
  };

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">{children}</main>
    </div>
  );
}

function Terms({ offer }: { offer: PublicOffer }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-rule bg-surface p-4">
      <div>
        <dt className="text-sm text-ink-3">Invoice {offer.invoiceNumber}</dt>
        <dd className="figures text-md text-ink">{formatMoney(offer.invoiceAmount)}</dd>
      </div>
      <div>
        <dt className="text-sm text-ink-3">Due</dt>
        <dd className="text-md text-ink">{formatDate(offer.originalDueDate)}</dd>
      </div>
      <div>
        <dt className="text-sm text-ink-3">
          Discount for paying by {formatDate(offer.terms.payBy)}
        </dt>
        <dd className="figures text-md text-ink">
          {formatPercent(offer.terms.discountPct)} · {formatMoney(offer.discountAmount)}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-ink-3">Offer open until</dt>
        <dd className="text-md text-ink">{formatDateTime(offer.expiresAt)}</dd>
      </div>
    </dl>
  );
}

function ReplyResult({ result }: { result: OfferReplyResponse }) {
  const { offer, parsed } = result;
  const heading = useRef<HTMLHeadingElement>(null);
  // Take the person, and their screen reader, to the answer as it arrives.
  useEffect(() => {
    heading.current?.focus();
  }, [result]);
  return (
    <section
      aria-labelledby="reply-heading"
      className="space-y-3 rounded-md border border-rule bg-surface p-4"
    >
      <h2 id="reply-heading" ref={heading} tabIndex={-1} className="text-lg outline-none">
        Reply sent
      </h2>
      <p className="text-base text-ink">{result.message}</p>
      {parsed ? (
        <p className="text-base text-ink-2">
          We read your note as: <strong className="font-medium text-ink">{parsed.summary}</strong>.{' '}
          {parsed.interpretation === 'PROMISE_TO_PAY'
            ? `This is a best guess; ${offer.supplierName} will confirm it with you.`
            : null}
        </p>
      ) : null}
      {offer.state === 'ACCEPTED' ? (
        offer.payUrl ? (
          <a
            href={offer.payUrl}
            className="inline-block rounded-md bg-ink px-4 py-2 text-base font-medium text-on-ink"
          >
            Pay {formatMoney(offer.payNow)} on PayPal
          </a>
        ) : (
          <PendingNotice
            title="Waiting for PayPal confirmation"
            detail={`PayPal will email the updated invoice for ${formatMoney(offer.payNow)}.`}
          />
        )
      ) : null}
    </section>
  );
}

interface OpenOfferProps {
  token: string;
  offer: PublicOffer;
  onReplied: (result: OfferReplyResponse) => void;
}

function OpenOffer({ token, offer, onReplied }: OpenOfferProps) {
  const reply = useReplyToOffer(token);
  const [partOpen, setPartOpen] = useState(false);
  const [part, setPart] = useState('');
  const [partError, setPartError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<OfferReplyRequest | null>(null);

  const send = async (body: OfferReplyRequest) => {
    setSent(body);
    try {
      onReplied(await reply.mutateAsync(body));
      if (body.kind === 'TEXT') setText('');
    } catch (error) {
      const apiError = toApiError(error);
      if (body.kind === 'PAY_PART' && apiError.code === 'VALIDATION_FAILED')
        setPartError(apiError.message);
    }
  };

  const submitPart = (event: SyntheticEvent) => {
    event.preventDefault();
    const amount = normalizeMoneyInput(part);
    if (amount === null) {
      setPartError('Enter an amount like 2000');
      return;
    }
    setPartError(null);
    void send({ kind: 'PAY_PART', amountEarly: amount });
  };

  const submitText = (event: SyntheticEvent) => {
    event.preventDefault();
    if (text.trim() === '') return;
    void send({ kind: 'TEXT', text: text.trim() });
  };

  const busy = reply.isPending;
  const failure =
    reply.isError && !(sent?.kind === 'PAY_PART' && partError !== null) ? reply.error : null;

  return (
    <>
      {failure ? (
        <ErrorState
          title="Your reply wasn’t sent"
          error={failure}
          {...(toApiError(failure).code !== 'TOKEN_INVALID' && sent
            ? { onRetry: () => void send(sent), retrying: busy }
            : {})}
        />
      ) : null}
      <section aria-labelledby="choose-heading" className="space-y-4">
        <h2 id="choose-heading" className="text-lg">
          Your answer
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy && sent?.kind === 'PAY_NOW'}
            disabled={busy}
            onClick={() => void send({ kind: 'PAY_NOW' })}
          >
            Pay now with PayPal
          </Button>
          {offer.allowPartial ? (
            <Button
              aria-expanded={partOpen}
              disabled={busy}
              onClick={() => {
                setPartOpen((open) => !open);
              }}
            >
              Pay part now
            </Button>
          ) : null}
          <Button
            variant="ghost"
            loading={busy && sent?.kind === 'NOT_NOW'}
            disabled={busy}
            onClick={() => void send({ kind: 'NOT_NOW' })}
          >
            Not now
          </Button>
        </div>

        {partOpen && offer.allowPartial ? (
          <form
            onSubmit={submitPart}
            noValidate
            className="space-y-3 rounded-md border border-rule bg-surface p-4"
          >
            <Field
              label="Amount to pay now, before the discount"
              hint={`From ${formatMoney(offer.minPartial ?? '0.01')}. You get ${formatPercent(offer.terms.discountPct)} off this part; the rest stays due on ${formatDate(offer.originalDueDate)}.`}
              error={partError}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={part}
                  onChange={(e) => {
                    setPart(e.target.value);
                    setPartError(null);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={busy && sent?.kind === 'PAY_PART'}
              disabled={busy}
            >
              Pay this part
            </Button>
          </form>
        ) : null}

        <form onSubmit={submitText} className="space-y-2">
          <Field
            label="Or write a reply"
            hint={`For example: “Can pay half on Monday.” ${text.length}/${OFFER_REPLY_MAX_LENGTH}`}
          >
            {(control) => (
              <Textarea
                {...control}
                maxLength={OFFER_REPLY_MAX_LENGTH}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                }}
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={busy || text.trim() === ''}
            loading={busy && sent?.kind === 'TEXT'}
          >
            Send reply
          </Button>
        </form>
      </section>
    </>
  );
}

/** The page a client's person opens from the email: one offer, four ways to answer. */
export function Component() {
  const { token = '' } = useParams();
  const offer = usePublicOffer(token);
  const [result, setResult] = useState<OfferReplyResponse | null>(null);

  if (offer.isPending) {
    return (
      <Layout>
        <LoadingRegion label="Loading the offer">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </LoadingRegion>
      </Layout>
    );
  }
  if (offer.isError) {
    const error = toApiError(offer.error);
    return (
      <Layout>
        {error.code === 'TOKEN_INVALID' ? (
          <EmptyState headingLevel="h1" title="This link can’t be used">
            <p>{error.message}</p>
          </EmptyState>
        ) : (
          <ErrorState
            headingLevel="h1"
            title="Couldn’t load this offer"
            error={offer.error}
            onRetry={() => void offer.refetch()}
            retrying={offer.isFetching}
          />
        )}
      </Layout>
    );
  }

  // After a reply, the server's answer is the offer as it now stands.
  const data = result?.offer ?? offer.data;
  return (
    <Layout>
      <header className="space-y-2">
        <p className="text-sm text-ink-3">
          {data.supplierName} → {data.clientName}
          {data.demo ? ' · demo, no real money moves' : ''}
        </p>
        <h1 className="text-xl">
          Pay {formatMoney(data.payNow)} by {formatDate(data.terms.payBy)} instead of{' '}
          {formatMoney(data.terms.amountEarly)} on {formatDate(data.originalDueDate)}
        </h1>
        <p className="text-base text-ink-2">
          Paying early saves you {formatMoney(data.discountAmount)}, a return of{' '}
          {formatAnnualRate(data.impliedAnnualRate)}.
        </p>
      </header>
      {data.note ? (
        <blockquote className="border-l-2 border-rule-strong pl-3 text-base text-ink-2">
          {data.note}
        </blockquote>
      ) : null}
      <Terms offer={data} />
      {result ? <ReplyResult result={result} /> : null}
      {data.state === 'OPEN' ? (
        <OpenOffer token={token} offer={data} onReplied={setResult} />
      ) : result ? null : (
        <p
          role="status"
          className="rounded-md border border-rule bg-surface p-4 text-base text-ink"
        >
          {CLOSED[data.state](data)}
        </p>
      )}
    </Layout>
  );
}
