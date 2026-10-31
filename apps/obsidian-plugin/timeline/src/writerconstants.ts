/** Time after a successful write before explaining that metadata has not caught up. */
export const INDEXED_NOTICE_MS = 10000;
/** Duration of the slow-index notice. */
export const SLOW_NOTICE_MS = 8000;
/** Upper bound on a write's claim on the old index entry. */
export const HOLD_CAP_MS = 120000;
/** Minimum time a written change remains available to the later revert checker. */
export const OVERWRITE_WATCH_MS = 5000;
/** Time after release during which the later revert checker still watches a write. */
export const OVERWRITE_AFTER_RELEASE_MS = 3000;
/** Delay before asking views to recheck a refused stale line. */
export const RECHECK_MS = 2000;
/** Recent line changes that widen the duplicate-line safety check. */
export const AMBIGUITY_WINDOW_MS = 10000;
/** Duration of a refusal notice, also its merge interval. */
export const REFUSAL_NOTICE_MS = 8000;
/** Duration of a write's Undo notice when the view starts showing it. */
export const UNDO_NOTICE_MS = 10000;
/** Duration of a completed or already-completed Undo notice. */
export const UNDO_DONE_NOTICE_MS = 4000;
/** Maximum retained Undo notices, managed by the later Undo integration. */
export const UNDO_KEEP_MAX = 50;
/** Longest a note stays blocked after a file-system operation has an unknown outcome. */
export const FS_TIMEOUT_BLOCK_MS = 120000;
/** Quiet period for the later Tasks dialog dependency check. */
export const DEPENDENCY_QUIET_MS = 1500;
/** Longest the later Tasks dialog waits for dependency edits. */
export const DEPENDENCY_WAIT_MAX_MS = 5000;
