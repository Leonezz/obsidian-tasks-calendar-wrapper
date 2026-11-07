// Must come first: it fixes the time zone, the locale and "now" before any date is computed.
import "./golden-clock";
import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import isEqual from "underscore/modules/isEqual.js";
import { quickEntryTargets } from "@tasks-calendar-wrapper/core";
import { sameJsonValue } from "@tasks-calendar-wrapper/ui/src/sameJsonValue";
import type { UserOption } from "../src/useroptions";
import { NOW, settingsOf, stateOf } from "./visible-states";

// Brief-derived: compare the new helper with the old one on the timeline's actual option shapes.
test("sameJsonValue agrees with isEqual on the options the timeline compares", () => {
	const golden = settingsOf(stateOf("light-today-all-days-no-counter"));
	const variants: readonly (readonly [string, UserOption])[] = [
		["golden options", golden],
		["equal options", structuredClone(golden)],
		["taskFiles", { ...golden, taskFiles: ["Tasks.md", "Projects.md"] }],
		["hideTags", { ...golden, hideTags: ["#work", "#home"] }],
		["tagColorPalette", { ...golden, tagColorPalette: { ...golden.tagColorPalette, "#work": "#123456" } }],
		[
			"tagColorPalette key order",
			{ ...golden, tagColorPalette: Object.fromEntries(Object.entries(golden.tagColorPalette).reverse()) },
		],
		["dateFormat", { ...golden, dateFormat: "YYYY-MM-DD" }],
		["inbox", { ...golden, inbox: "Other inbox.md" }],
		["useBuiltinStyle", { ...golden, useBuiltinStyle: !golden.useBuiltinStyle }],
	];
	const valuesOf = (options: UserOption) => {
		const taskFiles = quickEntryTargets(options, NOW);
		const rows = {
			dateFormat: options.dateFormat,
			hideTags: options.hideTags,
			tagPalette: options.tagColorPalette,
			useBuiltinStyle: options.useBuiltinStyle,
		};
		return {
			options,
			taskFiles,
			provider: { ...rows, taskFiles, select: options.inbox },
			rows,
		};
	};
	for (const [leftName, leftOptions] of variants) {
		const left = valuesOf(leftOptions);
		for (const [rightName, rightOptions] of variants) {
			const right = valuesOf(rightOptions);
			for (const key of ["options", "taskFiles", "provider", "rows"] as const)
				assert.equal(
					sameJsonValue(left[key], right[key]),
					isEqual(left[key], right[key]),
					`${leftName} / ${rightName}: ${key}`,
				);
		}
	}
});
