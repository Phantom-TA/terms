/**
 * The rule-based goal parser: the deterministic mode of CONTEXT.md's "Goal parser" role. It reads
 * the owner's sentence ("I need $6,200 by Friday. Don't offer more than 1.2%, and don't contact
 * Pinecrest or Birch.") into the goal's fields. Anything it cannot find is left null and filled
 * from the owner's policy by the caller, which reports it in `defaultedFields`; the owner confirms
 * or edits every field before planning. The LLM parser (with a key) sits in front of this and its
 * output is held to the same schema.
 */
import {
  addDays,
  type Bps,
  type Cents,
  dayOfWeek,
  isIsoDate,
  nextWeekday,
  toCents,
} from '@terms/shared';

export interface ParsedGoal {
  amount: Cents | null;
  deadline: string | null;
  maxDiscountBps: Bps | null;
  bufferBps: Bps | null;
  /** Names exactly as written after "don't contact". */
  doNotContactNames: string[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "6,200" / "6200.50" / "6.2k" → cents. */
function moneyOf(digits: string, suffix: string | undefined): Cents | null {
  const clean = digits.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole = '0', frac = ''] = clean.split('.');
  if (suffix !== undefined && /^k$/i.test(suffix)) {
    // 6.2k = 6200.00: shift three decimal places.
    const scaled = `${whole}${(frac + '000').slice(0, 3)}`;
    return toCents(`${String(BigInt(scaled))}.00`);
  }
  if (frac.length > 2) return null;
  return toCents(`${String(BigInt(whole))}.${(frac + '00').slice(0, 2)}`);
}

export function parseAmount(text: string): Cents | null {
  // Dollar sign first: "$6,200", "$ 6.2k", "$6200".
  const dollar = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(k\b)?/i.exec(text);
  if (dollar?.[1] !== undefined) return moneyOf(dollar[1], dollar[2]);
  // "6200 dollars", "6.2k" (but never a percentage).
  const words =
    /\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(k\b|dollars?\b|usd\b)(?!\s?%)/i.exec(text);
  if (words?.[1] !== undefined)
    return moneyOf(words[1], /^k$/i.test(words[2] ?? '') ? 'k' : undefined);
  return null;
}

/** Percent after a "maximum" phrase, or before "max". */
export function parseMaxDiscount(text: string): Bps | null {
  const lead =
    /(?:max(?:imum)?(?: discount)?(?: of)?|no more than|not? (?:more|over|above) than|up to|at most|cap(?:ped)? at|(?:don'?t|do not|never) (?:offer|give|go|discount)(?: (?:more|over|above))?(?: than)?)\s*(\d+(?:\.\d+)?)\s?%/i.exec(
      text,
    );
  const trail = /(\d+(?:\.\d+)?)\s?%\s*(?:max(?:imum)?|tops|at most)\b/i.exec(text);
  const value = lead?.[1] ?? trail?.[1];
  return value === undefined ? null : percentToBpsLoose(value);
}

export function parseBuffer(text: string): Bps | null {
  const m =
    /(\d+(?:\.\d+)?)\s?%\s*(?:buffer|cushion|margin)|(?:buffer|cushion|margin) of\s*(\d+(?:\.\d+)?)\s?%/i.exec(
      text,
    );
  const value = m?.[1] ?? m?.[2];
  return value === undefined ? null : percentToBpsLoose(value);
}

function percentToBpsLoose(value: string): Bps | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** "by Friday", "by tomorrow", "in 5 days", "by Nov 13", "by 13 November", "by 2026-11-13". */
export function parseDeadline(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso?.[1] !== undefined && isIsoDate(iso[1])) return iso[1];
  if (/\b(today|tonight|end of (?:the )?day)\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  const inN = /\bin (\d{1,3}) (day|week)s?\b/.exec(t);
  if (inN?.[1] !== undefined) return addDays(today, Number(inN[1]) * (inN[2] === 'week' ? 7 : 1));
  if (/\b(?:end of (?:the |this )?week|this week)\b/.test(t)) return nextWeekday(today, 5);
  const next = /\bnext (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (next?.[1] !== undefined) {
    // "next Friday" is the Friday of next week.
    const wd = WEEKDAYS.indexOf(next[1]);
    const thisWeek = nextWeekday(today, wd, true);
    return dayOfWeek(today) < wd ? addDays(thisWeek, 7) : thisWeek;
  }
  const weekday =
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|fri|mon|tue|wed|thu|sat|sun)\b/.exec(
      t,
    );
  const abbr = weekday?.[1]?.slice(0, 3);
  if (abbr !== undefined) {
    const wd = WEEKDAYS.findIndex((d) => d.startsWith(abbr));
    return nextWeekday(today, wd, false);
  }
  const monthDay =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/.exec(
      t,
    ) ?? null;
  const dayMonth =
    /\b(\d{1,2})(?:st|nd|rd|th)? (?:of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(
      t,
    );
  const month = monthDay?.[1] ?? dayMonth?.[2];
  const day = monthDay?.[2] ?? dayMonth?.[1];
  if (month !== undefined && day !== undefined) {
    const year = Number(today.slice(0, 4));
    const mm = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
    const dd = day.padStart(2, '0');
    let candidate = `${String(year)}-${mm}-${dd}`;
    if (!isIsoDate(candidate)) return null;
    if (candidate < today) candidate = `${String(year + 1)}-${mm}-${dd}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  return null;
}

/** Names after "don't contact / never email / leave … alone". */
export function parseDoNotContact(text: string): string[] {
  const names: string[] = [];
  const phrase =
    /(?:don'?t|do not|never|without)\s+(?:contact|email|message|ask|chase|bother|touch|call)\s+([^.;!?]+)/gi;
  const leave = /leave\s+([^.;!?]+?)\s+(?:alone|out)\b/gi;
  for (const re of [phrase, leave]) {
    for (const m of text.matchAll(re)) {
      const list = (m[1] ?? '')
        .replace(/\b(please|either|at all|this time|for now)\b/gi, '')
        .split(/,|\bor\b|\band\b|\bnor\b|\//i)
        .map((n) => n.trim().replace(/^(?:the|either)\s+/i, ''))
        .filter((n) => n.length > 0);
      names.push(...list);
    }
  }
  return [...new Set(names)];
}

export function parseGoalText(text: string, today: string): ParsedGoal {
  return {
    amount: parseAmount(text),
    deadline: parseDeadline(text, today),
    maxDiscountBps: parseMaxDiscount(text),
    bufferBps: parseBuffer(text),
    doNotContactNames: parseDoNotContact(text),
  };
}

const normal = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Matches written names to the supplier's clients: an exact name, a name the client's name starts
 * with ("Pinecrest" → "Pinecrest Dental"), or the client's first word. Ambiguous names stay
 * unmatched so the owner chooses.
 */
export function matchClients(
  names: readonly string[],
  clients: readonly { id: string; name: string }[],
): { name: string; businessId: string | null; matchedName: string | null }[] {
  return names.map((name) => {
    const n = normal(name);
    const exact = clients.filter((c) => normal(c.name) === n);
    const prefix = clients.filter(
      (c) => normal(c.name).startsWith(`${n} `) || normal(c.name) === n,
    );
    const firstWord = clients.filter((c) => normal(c.name).split(' ')[0] === n.split(' ')[0]);
    const pick = [exact, prefix, firstWord].find((list) => list.length === 1)?.[0];
    return { name, businessId: pick?.id ?? null, matchedName: pick?.name ?? null };
  });
}
