import type { HintViewState } from './models/hint-state.js';

export interface ActivateDetail { source: string }
export interface FieldInputDetail {
  name: string;
  value: string;
  reason?: 'reset';
}
export interface CopyResultDetail { source: string; copied: boolean }
export type HintStateDetail = Readonly<HintViewState & { source: string }>;
export type DetailsToggleDetail = Readonly<{ source: string; open: boolean }>;
export interface KitEventMap {
  'gv-activate': CustomEvent<ActivateDetail>;
  'gv-input': CustomEvent<FieldInputDetail>;
  'gv-copy-result': CustomEvent<CopyResultDetail>;
  'gv-close': CustomEvent<undefined>;
  'gv-hint-state': CustomEvent<HintStateDetail>;
  'gv-toggle': CustomEvent<DetailsToggleDetail>;
}
