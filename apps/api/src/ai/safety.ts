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

/**
 * The numbers in `text` that none of the `facts` contain. Empty means every figure the model wrote
 * can be found in what it was given, so it invented none.
 */
export function unsupportedNumbers(text: string, facts: readonly string[]): string[] {
  const allowed = new Set<string>();
  for (const fact of facts) for (const n of numbersIn(fact)) allowed.add(n);
  return [...numbersIn(text)].filter((n) => !allowed.has(n));
}

/** Words in a public message that would give away a side's policy or reasoning (D-023). */
const POLICY_WORDS =
  /\b(ceiling|hurdle|target rate|auto-?pay limit|cash buffer|never pay early|do[- ]not[- ]contact|policy|our maximum|our limit)\b/i;

export function revealsPolicy(text: string): boolean {
  return POLICY_WORDS.test(text);
}
