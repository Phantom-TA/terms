import { ActionType, DealState } from '@terms/shared';
import { lazy, type ReactNode, Suspense, useState } from 'react';
import { ApiError } from '../../api/errors';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip, EditableChip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorState } from '../../ui/ErrorState';
import { Field, Input, Select, Textarea } from '../../ui/Field';
import {
  ActionTag,
  AgentTag,
  BestEffortTag,
  DealStatePill,
  Money,
  MoneyWithDiscount,
  PolicyBadge,
  ProtectedTag,
} from '../../ui/finance';
import { PendingNotice } from '../../ui/PendingNotice';
import { SkeletonRows } from '../../ui/Skeleton';
import { useToast } from '../../ui/Toast';

// AG Grid Enterprise is large, so the rest of the page shouldn't wait for it.
const GridSpecimen = lazy(() =>
  import('./GridSpecimen').then((module) => ({ default: module.GridSpecimen })),
);

const SWATCHES: readonly { group: string; tokens: readonly [name: string, cls: string][] }[] = [
  {
    group: 'Surfaces and ink',
    tokens: [
      ['paper', 'bg-paper'],
      ['surface', 'bg-surface'],
      ['sunken', 'bg-sunken'],
      ['rule', 'bg-rule'],
      ['ink', 'bg-ink'],
      ['ink-2', 'bg-ink-2'],
      ['ink-3', 'bg-ink-3'],
    ],
  },
  {
    group: 'Accent: cash committed',
    tokens: [
      ['committed', 'bg-committed'],
      ['committed-strong', 'bg-committed-strong'],
      ['committed-soft', 'bg-committed-soft'],
    ],
  },
  {
    group: 'Status',
    tokens: [
      ['info', 'bg-info'],
      ['warn', 'bg-warn'],
      ['danger', 'bg-danger'],
      ['neutral', 'bg-neutral'],
      ['protected', 'bg-protected'],
    ],
  },
  {
    group: 'Negotiating parties',
    tokens: [
      ['supplier', 'bg-supplier'],
      ['client', 'bg-client'],
    ],
  },
];

const SAMPLE_ERROR = new ApiError({
  kind: 'server',
  status: 502,
  code: 'PAYPAL_ERROR',
  message: 'PayPal rejected the invoice update.',
  retryable: true,
  requestId: 'req_sample',
  paypal: {
    debugId: 'sample-debug-id',
    name: 'UNPROCESSABLE_ENTITY',
    message: 'Invalid request',
    httpStatus: 422,
  },
  policyChecks: [
    { rule: 'maxDiscount', result: 'blocked', detail: '1.50% is above the 1.20% maximum' },
  ],
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="border-b border-rule pb-1 text-lg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function Component() {
  const { toast, toastError } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState('6200');
  const [chipRemoved, setChipRemoved] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-8">
      <header>
        <h1 className="text-2xl">Style guide</h1>
        <p className="text-md text-ink-2">
          Internal, development only. Every figure here is sample data.
        </p>
      </header>

      <Section title="Colour">
        <div className="grid gap-6 sm:grid-cols-2">
          {SWATCHES.map(({ group, tokens }) => (
            <div key={group}>
              <h3 className="mb-2 text-base">{group}</h3>
              <ul className="flex flex-wrap gap-3">
                {tokens.map(([name, cls]) => (
                  <li key={name} className="w-20">
                    <div className={`h-10 rounded-md border border-rule ${cls}`} />
                    <p className="mt-1 text-xs text-ink-2">{name}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <p className="font-display text-2xl">$6,689 committed</p>
        <p className="font-display text-xl">Net 30 is a rule from the paper era</p>
        <p className="font-display text-lg">Cash runway</p>
        <p className="text-md">Body large: the owner states the goal in plain words.</p>
        <p className="text-base">Body: a reminder costs nothing and is never counted.</p>
        <p className="text-sm text-ink-2">Small: Last synced with PayPal at 10:42.</p>
        <p className="font-mono text-xs">INV2-XXXX-XXXX-XXXX-XXXX</p>
      </Section>

      <Section title="Buttons">
        <Row>
          <Button variant="primary">Approve plan</Button>
          <Button>Edit</Button>
          <Button variant="ghost">Dismiss</Button>
          <Button variant="danger">Reject</Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
        </Row>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Cost ceiling" hint="The most this plan may cost">
            {(p) => <Input {...p} defaultValue="60.00" />}
          </Field>
          <Field label="Discount" error="1.5% is above your 1.2% maximum">
            {(p) => <Input {...p} defaultValue="1.5" />}
          </Field>
          <Field label="Tone">
            {(p) => (
              <Select {...p}>
                <option>Friendly and brief</option>
                <option>Formal</option>
              </Select>
            )}
          </Field>
          <Field label="Reply">
            {(p) => <Textarea {...p} defaultValue="Can pay half Monday." />}
          </Field>
        </div>
      </Section>

      <Section title="Chips">
        <Row>
          <EditableChip
            label="Amount"
            display={`$${amount}`}
            editValue={amount}
            validate={(raw) => (/^\d+$/.test(raw) ? null : 'Enter whole dollars')}
            onCommit={(raw) => {
              setAmount(raw);
            }}
          />
          <Chip label="By">Fri, Nov 13</Chip>
          <Chip label="Max">1.2%</Chip>
          {chipRemoved ? null : (
            <Chip
              onRemove={() => {
                setChipRemoved(true);
              }}
              removeLabel="Remove sample chip"
            >
              Pinecrest Dental
            </Chip>
          )}
          <EditableChip label="Locked" display="$60" editValue="60" disabled onCommit={setAmount} />
        </Row>
      </Section>

      <Section title="Badges">
        <Row>
          <Badge>Neutral</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="warn">Warn</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="committed">Committed</Badge>
          <Badge tone="committed-solid">Paid</Badge>
          <Badge tone="protected">Protected</Badge>
          <BestEffortTag />
          <ProtectedTag />
          <AgentTag hasAgent />
          <AgentTag hasAgent={false} />
        </Row>
        <h3 className="text-base">Deal states</h3>
        <Row>
          {DealState.options.map((state) => (
            <DealStatePill key={state} state={state} />
          ))}
        </Row>
        <h3 className="text-base">Policy checks</h3>
        <Row>
          <PolicyBadge check={{ rule: 'hurdleRate', result: 'pass', detail: '18.5% beats 15%' }} />
          <PolicyBadge
            check={{ rule: 'maxDiscount', result: 'blocked', detail: 'Above the 1.20% maximum' }}
          />
          <PolicyBadge
            check={{ rule: 'costCeiling', result: 'needs_approval', detail: '$1 over the ceiling' }}
          />
        </Row>
        <h3 className="text-base">Actions</h3>
        <Row>
          {ActionType.options.map((action) => (
            <ActionTag key={action} action={action} />
          ))}
        </Row>
      </Section>

      <Section title="Money">
        <Row>
          <Money value="5000.00" />
          <Money value="4960.00" committed />
          <MoneyWithDiscount original="5000.00" discounted="4960.00" />
          <Money value="-11400.00" />
        </Row>
      </Section>

      <Section title="Cards and overlays">
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="Cost ceiling"
            description="What this plan may spend"
            actions={<Badge tone="warn">$1 over</Badge>}
          >
            <p>A card holds one idea, with a hairline around it and no shadow.</p>
          </Card>
          <Card>
            <Row>
              <Button
                onClick={() => {
                  toast({ tone: 'info', title: 'Sample notice', description: 'Disappears soon.' });
                }}
              >
                Show toast
              </Button>
              <Button
                onClick={() => {
                  toastError('Sample failure', SAMPLE_ERROR);
                }}
              >
                Show error toast
              </Button>
              <Button
                onClick={() => {
                  setDialogOpen(true);
                }}
              >
                Open dialog
              </Button>
            </Row>
          </Card>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Approve this counter?"
          description="It takes the plan $1 over your $60 ceiling."
          footer={
            <Button
              variant="primary"
              onClick={() => {
                setDialogOpen(false);
              }}
            >
              Close sample
            </Button>
          }
        />
      </Section>

      <Section title="Screen states">
        <h3 className="text-base">Loading</h3>
        <SkeletonRows rows={3} columns={5} label="Loading sample rows" />
        <h3 className="text-base">Empty</h3>
        <EmptyState title="No open invoices">Create one in PayPal or run the demo seed.</EmptyState>
        <h3 className="text-base">Error</h3>
        <ErrorState
          error={SAMPLE_ERROR}
          onRetry={() => {
            toast({ tone: 'info', title: 'Retry pressed', description: 'Sample only.' });
          }}
        />
        <h3 className="text-base">Pending</h3>
        <PendingNotice detail="Juniper Labs approved in PayPal. This updates when the verified webhook arrives." />
      </Section>

      <Section title="AG Grid">
        <Suspense fallback={<SkeletonRows rows={4} columns={6} label="Loading the grid" />}>
          <GridSpecimen />
        </Suspense>
      </Section>
    </div>
  );
}
