/** A fake AI runner for tests: answers each role from a script and remembers what it was asked. */
import { AiRoleError, type AiRunner, type RoleCall } from '../../src/ai/runner.js';

export type Script = (call: RoleCall<unknown>) => unknown;

export class ScriptedRunner implements AiRunner {
  readonly calls: RoleCall<unknown>[] = [];

  /** A script returns the answer, or throws (or returns) an Error to make the call fail. */
  constructor(private readonly script: Script) {}

  run<T>(call: RoleCall<T>): Promise<T> {
    this.calls.push(call);
    try {
      const answer = this.script(call);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(call.schema.parse(answer));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** The calls made to one role. */
  callsTo(role: string): RoleCall<unknown>[] {
    return this.calls.filter((c) => c.role === role);
  }
}

/**
 * A runner that answers one role and is unavailable for every other, so the rest of the app falls
 * back to its deterministic behaviour (as it does when a provider is down).
 */
export function forRole(role: string, answer: unknown): ScriptedRunner {
  return new ScriptedRunner((call) => {
    if (call.role !== role) return new AiRoleError('provider', call.role, 'not scripted');
    return typeof answer === 'function' ? (answer as () => unknown)() : answer;
  });
}

/** A runner that answers one role with a fixed answer. */
export function answering(role: string, answer: unknown): ScriptedRunner {
  return forRole(role, () => answer);
}
