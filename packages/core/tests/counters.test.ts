import { test } from "node:test";
import assert from "node:assert/strict";

import { counterClass } from "../src/counters";

// The counters either filter the timeline to their tasks ("Filter") or highlight their tasks ("Focus").
// Since 0.2.8 the class was built as "todoFilter Focus", so Focus hid the other tasks just like Filter.

test("no active counter adds no class", () => {
    assert.equal(counterClass("", "Filter"), "");
    assert.equal(counterClass("", "Focus"), "");
});

test("Filter behaviour gives the filter class", () => {
    assert.equal(counterClass("todoFilter", "Filter"), "todoFilter");
    assert.equal(counterClass("overdueFilter", "Filter"), "overdueFilter");
    assert.equal(counterClass("unplannedFilter", "Filter"), "unplannedFilter");
});

test("Focus behaviour gives the focus class and not the filter class", () => {
    assert.equal(counterClass("todoFilter", "Focus"), "todoFocus");
    assert.equal(counterClass("overdueFilter", "Focus"), "overdueFocus");
    assert.equal(counterClass("unplannedFilter", "Focus"), "unplannedFocus");
});
