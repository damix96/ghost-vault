import { RuntimeDeadline } from './deadline.js';

export class RuntimeActivity {
  private pending = new Map<Promise<unknown>, AbortController>();
  private accepting = true;

  public run = async <T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (!this.accepting) throw new Error('GhostVault is stopping');
    const controller = new AbortController();
    const task = action(controller.signal);
    this.pending.set(task, controller);
    try { return await task; }
    finally { this.pending.delete(task); }
  };

  public stopAdmission = (): void => { this.accepting = false; };
  public abort = (): void => { this.stopAdmission(); for (const controller of this.pending.values()) controller.abort(); };
  public drain = async (timeoutMs = 5000): Promise<void> => { await RuntimeDeadline.wait(Promise.allSettled([...this.pending.keys()]), timeoutMs); };
}
