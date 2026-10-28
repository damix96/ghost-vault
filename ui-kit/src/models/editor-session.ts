export type Fields = Readonly<Record<string, string>>;
export type SaveTicket = Readonly<{ entity: string; generation: number; version: number; operation: number; values: Fields }>;

export class EditorSession {
  entity: string;
  draft: Record<string, string>;
  baseline: Record<string, string>;
  pending = false;
  conflict = false;
  error = '';
  generation = 0;
  private version = 0;
  private operation = 0;

  constructor(entity: string, values: Fields) {
    this.entity = entity;
    this.draft = { ...values };
    this.baseline = { ...values };
  }

  dirty = () => !this.equal(this.draft, this.baseline);

  private equal = (left: Fields, right: Fields) => Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value);

  set = (key: string, value: string) => {
    if (this.draft[key] === value) return;
    this.draft = { ...this.draft, [key]: value };
    this.version++;
    this.error = '';
  };

  select = (entity: string, values: Fields) => {
    this.generation++;
    this.entity = entity;
    this.draft = { ...values };
    this.baseline = { ...values };
    this.pending = false;
    this.conflict = false;
    this.error = '';
    this.version++;
  };

  observe = (values: Fields) => {
    if (this.dirty() || this.pending) {
      this.conflict = !this.equal(values, this.baseline);
      return;
    }
    this.draft = { ...values };
    this.baseline = { ...values };
    this.conflict = false;
  };

  begin = (): SaveTicket => {
    if (this.pending) throw new Error('A save is already pending');
    this.pending = true;
    this.error = '';
    this.operation++;
    return Object.freeze({ entity: this.entity, generation: this.generation, version: this.version, operation: this.operation, values: Object.freeze({ ...this.draft }) });
  };

  private owns = (ticket: SaveTicket) => this.pending && ticket.entity === this.entity && ticket.generation === this.generation && ticket.operation === this.operation;

  complete = (ticket: SaveTicket, saved: Fields = ticket.values) => {
    if (!this.owns(ticket)) return false;
    this.pending = false;
    this.baseline = { ...saved };
    if (ticket.version === this.version) this.draft = { ...saved };
    this.conflict = false;
    return true;
  };

  fail = (ticket: SaveTicket, message: string) => {
    if (!this.owns(ticket)) return false;
    this.pending = false;
    this.error = ticket.version === this.version ? message : '';
    return true;
  };

  reset = () => {
    this.generation++;
    this.version++;
    this.draft = { ...this.baseline };
    this.pending = false;
    this.error = '';
    this.conflict = false;
  };

  close = () => {
    this.generation++;
    this.pending = false;
  };
}
