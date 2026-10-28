export class HistoryRetention {
  private generation = 0;
  private sessions = new Map<string, number>();

  public capture = (sessionId: string): (() => boolean) => {
    const generation = this.generation;
    const sessionGeneration = this.sessions.get(sessionId) || 0;
    return () => generation === this.generation && sessionGeneration === (this.sessions.get(sessionId) || 0);
  };

  public clear = (sessionId?: string): void => {
    if (sessionId !== undefined) this.sessions.set(sessionId, (this.sessions.get(sessionId) || 0) + 1);
    else {
      this.generation++;
      this.sessions.clear();
    }
  };
}
