export class HintLifecycle {
  static instances = root =>
    [...(root?.querySelectorAll('gv-hint') || [])];

  static pinned = root => HintLifecycle.instances(root).some(hint => hint.readState().pinned);

  static hide = (root = document) => {
    HintLifecycle.instances(root).forEach(hint => hint.hide());
  };
}
