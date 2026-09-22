import "./setup";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import "moment/locale/zh-cn";

import { relativeDate } from "../utils/utils";

// Loading a locale file switches moment over to it, so the default is set back here.
moment.locale("en");

const at = (value: string) => moment(value, "YYYY-MM-DD HH:mm", true);

// Issue #108: the label was computed from the current time, not from the current day,
// so from about noon onwards every task two or more days away read "in a day".

test("a task two days away reads the same at any time of day", () => {
    for (const hour of ["00:30", "09:00", "14:00", "23:30"]) {
        assert.equal(relativeDate(at("2026-09-24 00:00"), at(`2026-09-22 ${hour}`)), "in 2 days", hour);
    }
});

test("today, tomorrow and yesterday keep their words", () => {
    const now = at("2026-09-22 14:00");
    assert.equal(relativeDate(at("2026-09-22 00:00"), now), "Today");
    assert.equal(relativeDate(at("2026-09-23 00:00"), now), "Tomorrow");
    assert.equal(relativeDate(at("2026-09-21 00:00"), now), "Yesterday");
});

test("dates further in the past are counted in days", () => {
    const now = at("2026-09-22 14:00");
    assert.equal(relativeDate(at("2026-09-19 00:00"), now), "3 days ago");
    assert.equal(relativeDate(at("2026-10-02 00:00"), now), "in 10 days");
});

test("the time of day of the task itself does not change the label", () => {
    const now = at("2026-09-22 09:00");
    assert.equal(relativeDate(at("2026-09-24 23:00"), now), "in 2 days");
    assert.equal(relativeDate(at("2026-09-24 01:00"), now), "in 2 days");
});

test("day words carry no time and follow the moment locale", () => {
    const now = at("2026-09-22 14:00");
    const previous = moment.locale();
    try {
        moment.locale("zh-cn");
        assert.equal(relativeDate(at("2026-09-22 00:00"), now), "今天");
        assert.equal(relativeDate(at("2026-09-23 00:00"), now), "明天");
        assert.equal(relativeDate(at("2026-09-21 00:00"), now), "昨天");
        assert.equal(relativeDate(at("2026-09-24 00:00"), now), "后天");
        assert.equal(relativeDate(at("2026-09-25 00:00"), now), "3天后");
        assert.equal(relativeDate(at("2026-09-19 00:00"), now), "3天前");
    } finally {
        moment.locale(previous);
    }
});
