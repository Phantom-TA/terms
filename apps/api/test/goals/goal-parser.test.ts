import { dollars } from '@terms/shared';
import { describe, expect, it } from 'vitest';
import {
  matchClients,
  parseAmount,
  parseDeadline,
  parseGoalText,
} from '../../src/goals/goal-parser.js';

const TODAY = '2026-11-09'; // a Monday

/** 20 phrasings (CONTEXT.md, AI tests: amounts, dates, "max 1.2%", "don't contact X"). */
const PHRASINGS: [string, Partial<ReturnType<typeof parseGoalText>>][] = [
  [
    "I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact Pinecrest or Birch.",
    {
      amount: dollars(6200),
      deadline: '2026-11-13',
      maxDiscountBps: 120,
      doNotContactNames: ['Pinecrest', 'Birch'],
    },
  ],
  [
    'Need $6200 by friday, max 1.2%',
    { amount: dollars(6200), deadline: '2026-11-13', maxDiscountBps: 120 },
  ],
  [
    'payroll gap of 6.2k by Fri, 1.2% max',
    { amount: dollars(6200), deadline: '2026-11-13', maxDiscountBps: 120 },
  ],
  [
    'Raise $12,500.50 by tomorrow',
    { amount: 1250050n, deadline: '2026-11-10', maxDiscountBps: null },
  ],
  [
    'I need 3000 dollars in 5 days, no more than 2%',
    { amount: dollars(3000), deadline: '2026-11-14', maxDiscountBps: 200 },
  ],
  [
    '$8k by next Friday, up to 1.5%',
    { amount: dollars(8000), deadline: '2026-11-20', maxDiscountBps: 150 },
  ],
  [
    '$4,000 by Nov 20 — cap at 1%',
    { amount: dollars(4000), deadline: '2026-11-20', maxDiscountBps: 100 },
  ],
  [
    'Need $2,500 by 18 November. At most 0.8%.',
    { amount: dollars(2500), deadline: '2026-11-18', maxDiscountBps: 80 },
  ],
  [
    '$5,000 by 2026-11-30 max discount 1.2% with a 10% buffer',
    { amount: dollars(5000), deadline: '2026-11-30', maxDiscountBps: 120, bufferBps: 1000 },
  ],
  ['Get me $1,000 today', { amount: dollars(1000), deadline: TODAY }],
  [
    '$9,999 by end of week, never offer above 2.5%',
    { amount: dollars(9999), deadline: '2026-11-13', maxDiscountBps: 250 },
  ],
  ['$700 in 2 weeks', { amount: dollars(700), deadline: '2026-11-23' }],
  [
    'I need $6,200 by Friday; leave Harbor alone',
    { amount: dollars(6200), doNotContactNames: ['Harbor'] },
  ],
  ["$6,200 by Friday, don't email Oak Street Bakery", { doNotContactNames: ['Oak Street Bakery'] }],
  [
    '$6,200 by Friday. Do not contact Pinecrest, Birch and Juniper.',
    { doNotContactNames: ['Pinecrest', 'Birch', 'Juniper'] },
  ],
  ['$6,200 by Wednesday', { deadline: '2026-11-11' }],
  ['$6,200 by Monday', { deadline: TODAY }],
  ['need $ 6200 by Jan 5', { amount: dollars(6200), deadline: '2027-01-05' }],
  ['$6,200 by Friday, 1.2% tops, 5% cushion', { maxDiscountBps: 120, bufferBps: 500 }],
  [
    'Cover a 15% tax bill of $3,300 by Friday',
    { amount: dollars(3300), maxDiscountBps: null, bufferBps: null },
  ],
];

describe('rule-based goal parser on 20 phrasings', () => {
  it.each(PHRASINGS)('%s', (text, expected) => {
    expect(parseGoalText(text, TODAY)).toMatchObject(expected);
  });
});

describe('goal parser pieces', () => {
  it('finds no amount in a sentence without one, and never reads a percentage as money', () => {
    expect(parseAmount('help me get paid faster')).toBeNull();
    expect(parseAmount('max 1.2%')).toBeNull();
    expect(parseAmount('$1.234')).toBeNull();
  });

  it('finds no deadline when there is none, and refuses impossible dates', () => {
    expect(parseDeadline('as soon as you can', TODAY)).toBeNull();
    expect(parseDeadline('by Feb 30', TODAY)).toBeNull();
  });

  it('matches protected names to clients, leaving ambiguous ones for the owner', () => {
    const clients = [
      { id: 'p', name: 'Pinecrest Dental' },
      { id: 'b', name: 'Birch Legal' },
      { id: 'h', name: 'Harbor & Co' },
      { id: 'h2', name: 'Harbor Freight' },
      { id: 'o', name: 'Oak Street Bakery' },
    ];
    expect(
      matchClients(['Pinecrest', 'birch legal', 'Harbor', 'Harbor & Co', 'Oak', 'Nobody'], clients),
    ).toEqual([
      { name: 'Pinecrest', businessId: 'p', matchedName: 'Pinecrest Dental' },
      { name: 'birch legal', businessId: 'b', matchedName: 'Birch Legal' },
      { name: 'Harbor', businessId: null, matchedName: null },
      { name: 'Harbor & Co', businessId: 'h', matchedName: 'Harbor & Co' },
      { name: 'Oak', businessId: 'o', matchedName: 'Oak Street Bakery' },
      { name: 'Nobody', businessId: null, matchedName: null },
    ]);
  });
});
