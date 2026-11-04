export class RuntimeDrainTimeout extends Error {
  constructor() { super('Timed out waiting for active GhostVault requests to settle'); }
}

export class RuntimeDeadline {
  public static wait = async <T>(task: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new RuntimeDrainTimeout()), timeoutMs); });
    try { return await Promise.race([task, timeout]); }
    finally { clearTimeout(timer); }
  };
}
