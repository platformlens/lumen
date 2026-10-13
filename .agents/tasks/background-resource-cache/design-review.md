# Design Review: Background Resource Cache (revision 4, second amendment)

Reviewer: design-review step (fresh context). Scope, as instructed:
- (a) Check that the previous review's open finding is resolved in the design body, not just claimed in the response table (§14.2.2). The rev-3 findings (§14.2) and the first rev-4 amendment findings (§14.2.1) were confirmed resolved in earlier reviews and are not re-checked here.
- (b) Look for new HIGH issues introduced by the second amendment.

The "Verified Assumptions" facts from earlier reviews are reused as given, not re-derived.

Verdict: **APPROVED** (0 HIGH, 0 MEDIUM, 0 NIT).

---

## Previous-review finding resolution check

| Prev # | Sev | Status | Where checked |
|---|---|---|---|
| 1 | MEDIUM | **Resolved** | §3.5 fallback rules (ignored-result bullets), §8 matrix row "Helm fallback fetch / same uid but newer rv", §11 helm-index tests, §14.2.2 |

Notes:
- §3.5 now handles an ignored fallback-fetch result according to which field mismatched. None of the cases re-issues a fetch for the same `(uid, rv)`:
  - **Session mismatch:** no-op. `clear()` has already dropped the entry.
  - **uid mismatch:** the old uid goes back to `'none'`, but only if it is still at the fetched rv and still `'pending'` from this fetch. Then the recompute runs for the new target. A repeat is only possible if the max-revision uid changes again, so it is bounded by actual events.
  - **Same uid, entry rv unchanged since issue (fetch ahead of the watch):** the entry becomes `'failed'` with `corrupt = false`, and the recompute does not run. The label summary stays. When the newer rv arrives, the rv-change rule resets the entry and it decodes from the raw in hand. This is the reviewer's recommended fix, applied word for word.
  - **Same uid, entry rv changed since issue (watch ahead of the fetch):** no-op. The raw-in-hand path keeps ownership of `decodeState`. This case is new in this amendment and is correct. It stops a stale result from overwriting the `'pending'` state of a newer decode.
- "Entry rv unchanged since issue" is defined by comparing the entry's current rv with the rv stored in `fetchInFlight`. That rule is concrete and testable.
- §11 adds both requested tests:
  - "returns a newer rv for the same uid": one `readSecret`, `'failed'`/non-corrupt, then a MODIFIED decodes with no further fetch.
  - "overtaken by the watch".
- §8 has a matching row.

## New issues introduced by the amendment

None. Interactions I checked:
- **`retryOnce`:** a retry fetch that hits the "fetch ahead" case ends in `'failed'`. It is still one fetch per `(uid, rv)`, so the "no tight loop" guarantee in §3.5.1 holds.
- **Phase accounting:** fallback fetches still do not count toward `initialDecodesPending`, so the helm phase cannot get stuck.
- **Secret deleted before the lagging MODIFIED arrives:** the DELETED (or re-LIST diff delete) removes the entry through `onSecretDeleted`, and the release recomputes normally. No stuck `'failed'` max.
- **Fetch returning an older rv than the entry:** this case falls under "entry rv changed since issue" (no-op), so it is covered.

## Findings

None.

## Verified Assumptions

- All facts from the rev-3 and rev-4 "Verified Assumptions" sections are reused unchanged. These cover client-node 1.4.0 internals, package versions, the Dashboard/App/main/pod-worker/preload line facts, and `handleClusterSelect` batching at `src/App.tsx:763-833`.
- The amended §3.5 fallback rules agree with:
  - the §3.5 decode-state definitions (`'failed'` non-corrupt stays selectable and shows the label summary; a new rv resets the state);
  - the §3.5.1 whole-request retry rules;
  - the §8 rows at lines 1046-1047;
  - the §11 tests at lines 1168-1172.
- The §14.2.2 response says only §3.5, §8 and §11 changed. A diff against the previous review's quoted text matches that scope.

## Unverified / Wrong Assumptions

- **Unverified (runtime, carried over):**
  - The apiserver's bookmark cadence.
  - The `did-start-navigation` details shape in Electron 42.
  - The §1 reload root cause. The design still requires reproduction before and after the change (§11).
