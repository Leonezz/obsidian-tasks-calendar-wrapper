import { test } from "node:test";
import assert from "node:assert/strict";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StripWithIcon } from "../Obsidian-Tasks-Timeline/src/components/statusmarker";

// Issue #138: an open task was shown with a ticked checkbox

function render(marker: string, status: string, useBuiltinStyle: boolean): string {
    return renderToStaticMarkup(React.createElement(StripWithIcon, {
        marker, status, useBuiltinStyle, onToggle: () => undefined,
    }));
}

function isChecked(html: string): boolean {
    return /<input[^>]*\schecked=""/.test(html);
}

test("the checkbox of an open task is not ticked", () => {
    assert.equal(isChecked(render(" ", "unplanned", false)), false);
    assert.equal(isChecked(render(" ", "unplanned", true)), false);
});

test("the checkbox of a done task is ticked", () => {
    assert.equal(isChecked(render("x", "done", false)), true);
    assert.equal(isChecked(render("x", "done", true)), true);
});

// The checked state follows the task on every render instead of only setting the initial value,
// so a checkbox reused for another task cannot keep the previous task's state.
test("the checkbox is controlled by the task's marker", () => {
    const element = StripWithIcon.prototype.render.call({
        props: { marker: " ", status: "unplanned", useBuiltinStyle: false, onToggle: () => undefined },
    }) as React.ReactElement<{ children: React.ReactElement[] }>;
    const input = React.Children.toArray(element.props.children)[0] as React.ReactElement<Record<string, unknown>>;
    assert.equal(input.props.checked, false);
    assert.equal("defaultChecked" in input.props, false);
});

// Every task used the same element id, so clicking any icon toggled the first checkbox on the page
test("the checkbox has no shared element id", () => {
    for (const useBuiltinStyle of [true, false]) {
        const html = render(" ", "unplanned", useBuiltinStyle);
        assert.equal(/\sid="/.test(html), false);
        assert.equal(/\sfor="/.test(html), false);
    }
});
