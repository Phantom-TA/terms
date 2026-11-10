/**
 * Guards shared by the AI roles. A model's words are never trusted with money or policy: its
 * structured answer is validated by zod, bounded by code, and checked again by the policy layer.
 * These helpers cover the two text-level risks:
 *
 * - text we did not write (an owner's sentence, a client's reply) can contain instructions, so it
 *   is fenced in the prompt and the role's system text says it is data;
 * - text a model writes for people must not state figures the facts do not contain.
 */

/** Fences text we did not write. A closing tag inside the text cannot end the fence early. */
export function untrusted(tag: string, text: string): string {
  const inside = text.replace(new RegExp(`</?\\s*${tag}\\b[^>]*>`, 'gi'), '');
  return `<${tag}>\n${inside}\n</${tag}>`;
}

/** Every number written in `text`, as its plain value: "$1,729.00" and "1729" are both "1729". */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const raw of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const value = Number(raw.replaceAll(',', ''));
    if (Number.isFinite(value)) found.add(String(value));
  }
  return found;
}

const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
const PERCENT = /(\d[\d,]*(?:\.\d+)?)\s?%/g;

/** The figures in `text` by kind: dollar amounts, percentages, and every other number. */
function figuresIn(text: string): { money: Set<string>; percent: Set<string>; other: Set<string> } {
  const grab = (pattern: RegExp, from: string): [Set<string>, string] => {
    const found = new Set<string>();
    const rest = from.replace(pattern, (_all, digits: string) => {
      for (const n of numbersIn(digits)) found.add(n);
      return ' ';
    });
    return [found, rest];
  };
  const [money, withoutMoney] = grab(MONEY, text);
  const [percent, rest] = grab(PERCENT, withoutMoney);
  return { money, percent, other: numbersIn(rest) };
}

/**
 * The figures in `text` that the `facts` do not contain. Figures are matched by kind: a dollar
 * amount must be one the facts state in dollars, a percentage one they state as a percentage, and
 * any other number (a date part, an invoice number, a round) one they state as a plain number. So
 * the 9 in a date cannot vouch for an invented "9%". Empty means the model invented no figure.
 */
export function unsupportedNumbers(text: string, facts: readonly string[]): string[] {
  const allowed = figuresIn(facts.join(' | '));
  const used = figuresIn(text);
  return [
    ...[...used.money].filter((n) => !allowed.money.has(n)),
    ...[...used.percent].filter((n) => !allowed.percent.has(n)),
    ...[...used.other].filter((n) => !allowed.other.has(n)),
  ];
}

/** Words in a public message that would give away a side's policy or reasoning (D-023). */
const POLICY_WORDS =
  /\b(ceiling|hurdle|target rate|auto-?pay limit|cash buffer|never pay early|do[- ]not[- ]contact|policy|our maximum|our limit)\b/i;

export function revealsPolicy(text: string): boolean {
  return POLICY_WORDS.test(text);
}
