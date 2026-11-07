// Pins the badges' markup and click arguments, which must not change when they move.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { act, createElement, type MouseEvent as ReactMouseEvent } from "react";
import { createRoot } from "react-dom/client";
import { TagBadge, FileBadge, DateStatusBadge, ModifyBadge } from "../src/row/Badges";
import { dueIcon, priorityIcon } from "../src/icons";

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
	return { container, root };
}

/** Counts the clicks that reach the document body, past React's listener on the root container. */
function bodyClicks(t: TestContext) {
	let clicks = 0;
	const listener = () => clicks++;
	document.body.addEventListener("click", listener);
	t.after(() => document.body.removeEventListener("click", listener));
	return () => clicks;
}

test("TagBadge renders the tag link with its colour variables", async (t) => {
	const onClick = () => {};
	const coloured = mountRoot(t);
	await act(() => coloured.root.render(createElement(TagBadge, { tag: "#work", color: "#ff0000", onClick })));
	assert.equal(
		coloured.container.innerHTML,
		'<a href="#work" class="tag" target="_blank" rel="noopener" style="--tag-color: #ff0000; --tag-background: #ff00001a; z-index: 9999;" aria-label="#work"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"></path><path d="M7 7h.01"></path></svg></div><div class="label">work</div></a>',
	);

	const uncoloured = mountRoot(t);
	await act(() => uncoloured.root.render(createElement(TagBadge, { tag: "#work", color: undefined, onClick })));
	assert.equal(
		uncoloured.container.innerHTML,
		'<a href="#work" class="tag" target="_blank" rel="noopener" style="--tag-color: var(--text-muted); z-index: 9999;" aria-label="#work"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"></path><path d="M7 7h.01"></path></svg></div><div class="label">work</div></a>',
	);
});

test("TagBadge click passes the tag with its # and does not bubble", async (t) => {
	const { container, root } = mountRoot(t);
	const calls: string[][] = [];
	const bubbled = bodyClicks(t);
	await act(() =>
		root.render(
			createElement(TagBadge, { tag: "#work", color: "#ff0000", onClick: (...args) => calls.push(args) }),
		),
	);
	const link = container.querySelector("a");
	assert.ok(link);
	await act(() => {
		link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.deepEqual(calls, [["#work"]]);
	assert.equal(bubbled(), 0);
});

test("FileBadge renders the note title and the heading after ' > '", async (t) => {
	const withHeading = mountRoot(t);
	await act(() =>
		withHeading.root.render(createElement(FileBadge, { filePath: "folder/Note.md", subPath: "Heading" })),
	);
	assert.equal(
		withHeading.container.innerHTML,
		'<a class="file" aria-label="folder/Note.md"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg></div><div class="label">Note</div><span class="header">  &gt;  Heading</span></a>',
	);

	const withoutHeading = mountRoot(t);
	await act(() => withoutHeading.root.render(createElement(FileBadge, { filePath: "folder/Note.md", subPath: "" })));
	assert.equal(
		withoutHeading.container.innerHTML,
		'<a class="file" aria-label="folder/Note.md"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg></div><div class="label">Note</div><span class="header"></span></a>',
	);

	for (const { container } of [withHeading, withoutHeading]) {
		const bubbled = bodyClicks(t);
		const link = container.querySelector("a");
		assert.ok(link);
		await act(() => {
			link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		assert.equal(bubbled(), 1);
	}
});

test("DateStatusBadge renders its class, aria-label, icon and label", async (t) => {
	const relative = mountRoot(t);
	await act(() =>
		relative.root.render(
			createElement(DateStatusBadge, {
				className: "relative",
				ariaLabel: "due",
				label: "in 2 days",
				icon: dueIcon,
			}),
		),
	);
	assert.equal(
		relative.container.innerHTML,
		'<a class="relative" aria-label="due"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div><div class="label">in 2 days</div></a>',
	);

	const priority = mountRoot(t);
	await act(() =>
		priority.root.render(
			createElement(DateStatusBadge, {
				className: "priority",
				ariaLabel: "priority",
				label: "high",
				icon: priorityIcon,
			}),
		),
	);
	assert.equal(
		priority.container.innerHTML,
		'<a class="priority" aria-label="priority"><div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div><div class="label">high</div></a>',
	);
});

test("DateStatusBadge click passes the event, and without onClick it is inert", async (t) => {
	const clickable = mountRoot(t);
	const calls: ReactMouseEvent[][] = [];
	let currentTarget: EventTarget | null = null;
	const bubbled = bodyClicks(t);
	await act(() =>
		clickable.root.render(
			createElement(DateStatusBadge, {
				className: "relative",
				ariaLabel: "due",
				label: "in 2 days",
				icon: dueIcon,
				onClick: (...args) => {
					calls.push(args);
					currentTarget = args[0].currentTarget;
				},
			}),
		),
	);
	const link = clickable.container.querySelector("a");
	assert.ok(link);
	await act(() => {
		link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].length, 1);
	assert.equal(calls[0][0].type, "click");
	assert.ok(calls[0][0].nativeEvent instanceof MouseEvent);
	assert.equal(currentTarget, link);
	assert.equal(bubbled(), 1);

	const inert = mountRoot(t);
	const inertBubbled = bodyClicks(t);
	await act(() =>
		inert.root.render(
			createElement(DateStatusBadge, {
				className: "relative",
				ariaLabel: "due",
				label: "in 2 days",
				icon: dueIcon,
			}),
		),
	);
	const inertLink = inert.container.querySelector("a");
	assert.ok(inertLink);
	await act(() => {
		assert.doesNotThrow(() => inertLink.dispatchEvent(new MouseEvent("click", { bubbles: true })));
	});
	assert.equal(inertBubbled(), 1);
});

test("ModifyBadge renders ✏️ labelled Modify Task and passes the click event", async (t) => {
	const { container, root } = mountRoot(t);
	const calls: ReactMouseEvent[][] = [];
	const bubbled = bodyClicks(t);
	await act(() => root.render(createElement(ModifyBadge, { onClick: (...args) => calls.push(args) })));
	assert.equal(container.innerHTML, '<a class="modify" aria-label="Modify Task">✏️</a>');
	const link = container.querySelector("a");
	assert.ok(link);
	await act(() => {
		link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].length, 1);
	assert.equal(calls[0][0].type, "click");
	assert.ok(calls[0][0].nativeEvent instanceof MouseEvent);
	assert.equal(bubbled(), 1);
});
