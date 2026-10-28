export type HintMode = 'closed' | 'preview' | 'pinned';
export type HintViewState = Readonly<{ mode: HintMode; open: boolean; pinned: boolean }>;

export class HintState {
  mode: HintMode = 'closed';
  preview = () => { if (this.mode === 'closed') this.mode = 'preview'; };
  leave = () => { if (this.mode === 'preview') this.mode = 'closed'; };
  pin = () => { this.mode = this.mode === 'pinned' ? 'closed' : 'pinned'; };
  close = () => { this.mode = 'closed'; };
  active = () => this.mode !== 'closed';
  pinned = () => this.mode === 'pinned';
}
