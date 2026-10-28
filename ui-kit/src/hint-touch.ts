export class HintTouch {
  private timer?: ReturnType<typeof setTimeout>;
  private pointer?: { id: number; x: number; y: number; pinned: boolean };
  private suppressUntil = 0;

  constructor(private readonly pin: () => void) {}

  start = (event: PointerEvent) => {
    this.reset();
    if (event.pointerType !== 'touch' || !event.isPrimary || event.button !== 0) return;
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pinned: false };
    this.timer = setTimeout(this.recognize, 600);
  };

  private recognize = () => {
    if (!this.pointer || this.pointer.pinned) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pointer.pinned = true;
    this.suppressUntil = Infinity;
    this.pin();
  };

  observeDown = (event: PointerEvent) => {
    if (!this.pointer || event.pointerId !== this.pointer.id) this.reset();
  };

  move = (event: PointerEvent) => {
    if (this.pointer?.id === event.pointerId && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 8) this.cancelPending();
  };

  end = (event: PointerEvent) => {
    if (this.pointer?.id !== event.pointerId) return;
    if (event.type === 'pointercancel') { this.reset(); return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pointer.pinned) this.suppressUntil = Date.now() + 800;
    this.pointer = undefined;
  };

  context = (event: Event) => {
    if (!this.pointer) return;
    event.preventDefault();
    this.recognize();
  };

  consumeClick = (event: MouseEvent) => {
    if (event.detail === 0 || Date.now() > this.suppressUntil) return;
    this.suppressUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  cancelPending = () => {
    if (this.pointer?.pinned) return;
    this.reset();
  };

  reset = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pointer = undefined;
    this.suppressUntil = 0;
  };
}
