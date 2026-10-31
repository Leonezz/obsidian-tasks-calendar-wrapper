import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { parseTaskLine } from "@tasks-calendar-wrapper/core";
import { createPendingWrites } from "../timeline/src/pendingwrites";
import type { WriteEvent } from "../timeline/src/taskwriter";

test("a pending replace dims without predicting a marker or status", () => {
	const task = parseTaskLine("- [ ] Pay", { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	const event: WriteEvent = {
		id: 1,
		kind: "pending",
		action: "replace",
		path: task.path,
		line: task.line,
		sourceLine: task.sourceLine,
		lines: ["- [x] Pay rent"],
	};
	pending.apply(event, [task], {}, { now: moment("2026-11-01"), moment });
	assert.deepEqual(pending.getSnapshot(task.id), { id: 1, path: task.path, dimmed: true });
});

test("an Undo of a dialog edit still predicts the restored marker and status", () => {
	const sourceLine = "- [ ] Pay";
	const task = parseTaskLine("- [x] Pay rent", { moment, path: "Note.md" });
	assert.ok(task);
	const pending = createPendingWrites();
	pending.apply(
		{
			id: 2,
			kind: "pending",
			action: "undo",
			path: task.path,
			line: task.line,
			sourceLine,
			lines: [sourceLine],
			written: [task.sourceLine],
		},
		[task],
		{},
		{ now: moment("2026-11-01"), moment },
	);
	assert.equal(pending.getSnapshot(task.id)?.dimmed, true);
	assert.equal(pending.getSnapshot(task.id)?.marker, " ");
	assert.equal(pending.getSnapshot(task.id)?.status, "unplanned");
});
