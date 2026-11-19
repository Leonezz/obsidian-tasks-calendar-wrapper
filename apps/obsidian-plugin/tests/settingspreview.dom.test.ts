import "./golden-clock";

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, Fragment, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { copy } from "@tasks-calendar-wrapper/core";
import { HostContext, TaskRow, timelineDisplayClasses, type UiHost } from "@tasks-calendar-wrapper/ui";
import { SettingsPreview, settingsPreviewSample } from "../src/settings/preview";
import { defaultUserOptions, type UserOption } from "../src/useroptions";
import { moment } from "../utils/moment";

const host: UiHost = {
	isMobile: false,
	now: () => moment(),
	moment,
	renderMarkdown: (markdown) => markdown,
};

function options(overrides: Partial<UserOption> = {}): UserOption {
	return { ...defaultUserOptions, tagColorPalette: { "#work": "#123456" }, ...overrides };
}

function mountRoot(t: TestContext) {
	const container = document.body.appendChild(document.createElement("div"));
	const root = createRoot(container);
	t.after(async () => {
		try {
			await act(() => root.unmount());
		} finally {
			container.remove();
		}
	});
	return {
		container,
		render: async (next: UserOption, nextHost = host) => {
			await act(() => root.render(createElement(SettingsPreview, { options: next, host: nextHost })));
		},
		root,
	};
}

function element<T extends HTMLElement = HTMLElement>(container: HTMLElement, selector: string): T {
	const found = container.querySelector<T>(selector);
	assert.ok(found, selector);
	return found;
}

function rowMarkup(row: HTMLElement): string {
	const clone = row.cloneNode(true) as HTMLElement;
	// A preview owns its row IDs; all visual and semantic row markup must otherwise be identical.
	for (const node of [clone, ...clone.querySelectorAll("[id], [aria-labelledby]")]) {
		node.removeAttribute("id");
		node.removeAttribute("aria-labelledby");
	}
	return clone.outerHTML;
}

test("the settings preview renders the exact production TaskRow markup", async (t) => {
	const { container, root } = mountRoot(t);
	const selected = options();
	const sample = settingsPreviewSample(selected, host);
	const noAction = () => {};
	const callbacks: ComponentProps<typeof TaskRow>["callbacks"] = {
		handleOpenFile: noAction,
		handleCompleteTask: noAction,
		handleTagClick: noAction,
		handleModifyTask: noAction,
		handleRowMenu: undefined,
		handleDateBadge: undefined,
	};
	await act(() =>
		root.render(
			createElement(
				Fragment,
				null,
				createElement(SettingsPreview, { options: selected, host }),
				createElement(
					"div",
					{ className: "standalone" },
					createElement(
						HostContext.Provider,
						{ value: host },
						createElement(TaskRow, {
							model: sample.model,
							callbacks,
							clock: { lastListChangeAt: -Infinity },
						}),
					),
				),
			),
		),
	);
	const preview = element(container, ".tcw-settings-preview-surface .task");
	const production = element(container, ".standalone .task");
	assert.equal(rowMarkup(preview), rowMarkup(production));
	assert.equal(preview.getAttribute("role"), "listitem");
	assert.equal(element(preview, ".content").textContent, copy.settings.tab.previewTask);
	assert.ok(preview.querySelector(".timeline label.icon svg"));
	for (const badge of ["priority", "repeat", "relative", "file", "tag"]) {
		assert.ok(preview.querySelector(`.${badge} .icon svg`), badge);
	}
	assert.equal(element(preview, ".priority .label").textContent, "High priority");
	assert.equal(element(preview, ".repeat .label").textContent?.trim(), "every week");
	assert.equal(element(preview, ".relative .label").textContent, "Today");
	assert.equal(element(preview, ".file .label").textContent, copy.settings.tab.previewNote);
	assert.match(element(preview, ".file .header").textContent ?? "", new RegExp(copy.settings.tab.previewSection));
	assert.equal(preview.querySelectorAll(".tag").length, 1);
});

test("the sample uses canonical tag parsing, palette colors and hidden tag rules", async (t) => {
	const { container, render } = mountRoot(t);
	const selected = options({ tagColorPalette: { "#invalid tag": "#ff0000", "#work": "#123456" } });
	const sample = settingsPreviewSample(selected, host);
	assert.deepEqual(sample.model.tags, [{ tag: "#work", color: "#123456" }]);
	await render(selected);
	const tag = element(container, ".task .tag");
	assert.equal(tag.getAttribute("href"), "#work");
	assert.equal(tag.style.getPropertyValue("--tag-color"), "#123456");
	assert.equal(tag.style.getPropertyValue("--tag-background"), "#1234561a");
	assert.equal(element(tag, ".label").textContent, "work");
	assert.doesNotMatch(element(container, ".task .content").textContent ?? "", /#work|#invalid/);

	await render({ ...selected, hideTags: ["#work"] });
	assert.equal(container.querySelector(".task .tag"), null);
	assert.ok(container.querySelector(".task .priority"));
	await render({ ...selected, tagColorPalette: { "#work": "#654321" } });
	assert.equal(element(container, ".task .tag").style.getPropertyValue("--tag-color"), "#654321");
});

test("display settings update the real date heading, row checkbox and shared timeline classes", async (t) => {
	const { container, render } = mountRoot(t);
	await render(options());
	const contentId = element(container, ".task .content").id;
	assert.equal(element(container, ".dateLine .date").textContent, "Thursday, Jan, 15");
	assert.ok(container.querySelector(".task .timeline label.icon svg"));
	assert.equal(element(container, '.timeline input[type="checkbox"]').className, "icon");

	const updated = options({
		dateFormat: "YYYY/MM/DD",
		useBuiltinStyle: false,
		useYearHeader: false,
		useFileBadge: false,
		usePriority: false,
		useRelative: false,
		useModifyBadge: false,
	});
	await render(updated);
	assert.equal(element(container, ".dateLine .date").textContent, "2026/01/15");
	assert.equal(element(container, ".task .relative").getAttribute("aria-label"), `${copy.row.duePrefix}2026/01/15`);
	assert.equal(element(container, ".task .content").id, contentId);
	assert.equal(container.querySelector(".task .timeline label.icon"), null);
	assert.equal(element(container, '.timeline input[type="checkbox"]').className, "");
	assert.equal(element(container, ".taskido").className, `taskido ${timelineDisplayClasses(updated)}`);
	for (const flag of ["noYear", "noFile", "noPriority", "noRelative", "noModify"]) {
		assert.ok(element(container, ".taskido").classList.contains(flag), flag);
	}
	const noInfo = { ...updated, useRecurrence: false, useSection: false, useTags: false };
	await render(noInfo);
	assert.equal(element(container, ".taskido").className, `taskido ${timelineDisplayClasses(noInfo)}`);
	assert.ok(element(container, ".taskido").classList.contains("noInfo"));
});

test("preview capture prevents checkbox, note, tag, edit and native markdown link actions", async (t) => {
	const { container, render } = mountRoot(t);
	await render(options(), {
		...host,
		renderMarkdown: (markdown) => `<span>${markdown}</span> <a href="https://example.com/task">Reference</a>`,
	});
	const checkbox = element<HTMLInputElement>(container, '.task input[type="checkbox"]');
	const before = element(container, ".task").outerHTML;
	const location = window.location.href;
	const reachedTarget = t.mock.fn();
	const bubbled = t.mock.fn();
	container.addEventListener("click", bubbled);
	for (const selector of [
		'.task input[type="checkbox"]',
		".task label.icon",
		".task .content > a",
		".task .content a[href]",
		".task .tag",
		".task .file",
		".task .modify",
	]) {
		const target = element(container, selector);
		target.addEventListener("click", reachedTarget);
		const event = new MouseEvent("click", { bubbles: true, cancelable: true });
		await act(() => target.dispatchEvent(event));
		assert.equal(event.defaultPrevented, true, selector);
		assert.equal(checkbox.checked, false, selector);
	}
	assert.equal(reachedTarget.mock.callCount(), 0);
	assert.equal(bubbled.mock.callCount(), 0);
	assert.equal(window.location.href, location);
	assert.equal(element(container, ".task").outerHTML, before);
});

test("preview keyboard, context menu and auxiliary clicks cannot invoke row actions", async (t) => {
	const { container, render } = mountRoot(t);
	await render(options({ useBuiltinStyle: false }));
	const row = element(container, ".task");
	const checkbox = element<HTMLInputElement>(container, '.task input[type="checkbox"]');
	const reachedTarget = t.mock.fn();
	for (const selector of [".task", ".task .modify", ".task .tag", '.task input[type="checkbox"]']) {
		const target = element(container, selector);
		for (const key of ["Enter", " ", "F10", "ContextMenu"]) {
			target.addEventListener("keydown", reachedTarget, { once: true });
			const event = new KeyboardEvent("keydown", {
				key,
				shiftKey: key === "F10",
				bubbles: true,
				cancelable: true,
			});
			await act(() => target.dispatchEvent(event));
			assert.equal(event.defaultPrevented, true, `${selector}: ${key}`);
		}
		for (const type of ["contextmenu", "auxclick"]) {
			target.addEventListener(type, reachedTarget, { once: true });
			const event = new MouseEvent(type, { button: 1, bubbles: true, cancelable: true });
			await act(() => target.dispatchEvent(event));
			assert.equal(event.defaultPrevented, true, `${selector}: ${type}`);
		}
	}
	assert.equal(reachedTarget.mock.callCount(), 0);
	assert.equal(checkbox.checked, false);
	assert.equal(row.getAttribute("data-task"), " ");
	assert.equal(row.hasAttribute("aria-busy"), false);
});
