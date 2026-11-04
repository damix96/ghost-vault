# Response restoration evidence

Status: implemented; task `both-sides-change-view-20261104-backend`; frontend contract agreed with `/root/impeccable_refinement`. Scope: backend only; live/public/real database unchanged.

## Decision

Why: an original may already occur literally in a model response. Searching the restored response for originals falsely labels that occurrence as a replacement. Goal: display only transformations actually performed. Mechanism: observe the real replacement callback, retain its exact alias/value and coordinates, then extract context from the complete decoded field. Alternative rejected: diffing normalized response bodies or reconstructing aliases from current secret names loses escaping, archived versions and stream boundaries.

Implementation: `ghostvault/src/telemetry/response-change-evidence.ts`; integration in `proxy/server.ts`, `proxy/sliding-buffer.ts`, `protocols/stream-buffers.ts`, `proxy/sse-transformer.ts`, `proxy/stream-relay.ts`. `vault/store.ts#getInboundReplacements` includes the owning key from the immutable request snapshot, including archived manual representations. No token grammar, mapping allocation or persistence changes.

## API contract

Existing session/history transaction responses add optional `responseChanges`; old records/fixtures can omit it. No endpoint/request changes. Defined by `telemetry/types.ts` and `telemetry/response-change-evidence.ts`:

```ts
interface Fragment {
  text: string;
  start: number;
  end: number;
  contextStart: number;
  totalLength: number;
}
interface ResponseChanges {
  version: 1;
  status: 'pending' | 'complete' | 'interrupted' | 'not-processed';
  stage: 'restoration';
  postHookModified: boolean;
  items: Array<{
    id: string;
    fieldId: string;
    source: 'response-field' | 'stream-text' | 'tool-arguments' | 'protocol-snapshot';
    alias: string;
    value: string;
    key?: string;
    before: Fragment;
    after: Fragment;
  }>;
}
```

| Property | Guarantee / boundary |
| --- | --- |
| `items` | Actual replacement operations only; unchanged literals, unknown aliases and identity replacements excluded. |
| `alias`, `value`, `key` | Exact wire alias and restored representation; owner key comes from the request snapshot, not current vault lookup. Custom replacement providers may omit key. |
| Coordinates | UTF-16 JS indices in decoded string fields. `start/end` index the highlight within `text`; `contextStart` indexes the excerpt within the full field; `totalLength` is full decoded field length. End offsets exclusive. |
| Context | Up to 96 code units each side, extended by one to avoid splitting a surrogate pair; complete replacement retained. |
| Same `fieldId` | All `after` excerpts reference the same final restored field. Exact overlapping contexts may be merged. Field IDs are opaque callback/buffer identities, not JSONPaths. |
| IDs | `restore-N`, stable append order within the request; no cross-request identity promise. |
| `source` | Ordinary decoded leaves; streaming text; decoded tool-argument leaves; repeated protocol terminal snapshots. Protocol snapshots are separate real operations, not deduplicated against deltas. |
| Status | `pending` may have no finalized fields; `complete` with empty items means no restoration; `interrupted` retains observed evidence; upstream error bypass is `not-processed`. Missing property means evidence unavailable. |
| Hooks / delivery | Evidence describes restoration stage, not proof of network delivery. Later modifying response/chunk hooks set `postHookModified`; UI must label that stage. |

SSE evidence is finalized when a field buffer flushes, not on every delta. Sliding replacement callbacks supply absolute input/output offsets across arbitrary splits. Tool arguments use decoded JSON leaf transformation; discarded incomplete argument buffers produce no fabricated evidence. Escaping is performed by the existing protocol serializers. Responses done/completed snapshots remain separate evidence, allowing a compact protocol disclosure rather than duplicate main-text rendering.

## Lifetime and compatibility

Per-request immutable mappings preserve exact recovery after manual edit/delete. Evidence retains only the current runtime transaction under the existing latest-started policy (§6.2 of master spec); superseded requests cannot replace the newer snapshot. Existing canonical-JSON byte accounting includes evidence. Active in-flight buffers live until request completion; no extra global history/cache introduced. Eviction/delete/restart drop evidence with its session. No new SQLite traffic writes, migration, dependency or legacy deletion. Full `response.body` remains available for explicit full-view selection.

## Verification

`npx tsc --pretty false` PASS. All nine isolated test executables PASS: `test-response-change-evidence`, `test-protocols`, `test-protocol-streams`, `test-composite-replacements`, `test-secret-labels`, `test-runtime-retention`, `test-runtime-sessions-api`, `test-gateway-regressions`, `test-protocol-transport`. Set `GHOSTVAULT_DB_PATH=:memory:`; tests use synthetic values/local mocks.

New evidence tests: literal original plus two real aliases; unknown/no-change text; every split boundary; encoded and archived aliases; escaped JSON tool arguments; repeated terminal snapshots; interrupted arguments; downstream hook modification; deletion after immutable request snapshot; API serialization; latest-only retention; budget includes evidence; SQLite traffic remains empty. Existing retention tests cover actual 200 MB budget, active/sole oversized sessions, restart, out-of-order calls and preview revisions.

Frontend owner independently reported local HTTP mock/browser PASS on this implementation: two actual restores produce two highlights and one merged fragment despite a literal original; split SSE restores at completion; ordinary view excludes full text. Final `totalLength` addition is additive; final visual acceptance remains frontend-owned.

## Artifact and integration

Artifact `.cache/both-sides-backend-20261104`: complete `dist/`, scoped source snapshot under `sources/`, package manifests, SHA256 `manifest.json`. Build uses TypeScript only; public assets are excluded. No new dependencies; use the existing locked dependency installation. Coordinator should integrate scoped sources, combine with frontend stage, verify manifest hashes, then publish through the existing deployment process. No database migration required. Rollback restores prior backend/UI artifact; volatile sessions naturally disappear on restart, durable state is unchanged. Do not use this backend artifact alone as a UI release.

Skill assessment: backend-invariants directly covered snapshot identity, stream reversibility, lifetime and negative evidence checks; no material gap identified for this task.
