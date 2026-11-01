import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runReverts } from "./revert-model";
import { ownWriteSequences } from "./revert-own-sequences";

for (const sequence of ownWriteSequences) {
	test(`model fixed: ${sequence.name}${sequence.variant ? ` (${sequence.variant})` : ""}`, async () => {
		const failure = await runReverts(sequence.steps, {
			initial: sequence.initial ?? ["- [ ] A"],
			...sequence.options,
		});
		assert.equal(failure, null, failure?.message);
	});
}
