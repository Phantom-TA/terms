/** A fake AI runner for tests: answers each role from a script and remembers what it was asked. */
import { type AiRunner, type RoleCall } from '../../src/ai/runner.js';

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

/** A runner that answers one role with a fixed answer and fails any other role. */
export function answering(role: string, answer: unknown): ScriptedRunner {
  return new ScriptedRunner((call) => {
    if (call.role !== role) throw new Error(`unexpected role ${call.role}`);
    return answer;
  });
}
