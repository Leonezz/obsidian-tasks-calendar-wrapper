import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { selectCssTheme } from "../scripts/screenshots-themes.mjs";

const BLUE_TOPAZ_CSS = "body { color: rgb(1, 2, 3); } /* Blue Topaz \u00e9 */";
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function fakeApp(
	t: TestContext,
	options: {
		theme: string;
		config: string | undefined;
		css?: string;
		installed?: boolean;
		disabled?: boolean;
		keepConfig?: boolean;
	},
) {
	const previousApp = Object.getOwnPropertyDescriptor(globalThis, "app");
	t.after(() => {
		if (previousApp) Object.defineProperty(globalThis, "app", previousApp);
		else Reflect.deleteProperty(globalThis, "app");
	});
	let config = options.config;
	const styleEl = document.createElement("style");
	styleEl.textContent = "body { color: red; } /* stale stylesheet */";
	const vault = {
		getConfig(key: string) {
			assert.equal(key, "cssTheme");
			return config;
		},
		setConfig(key: string, value: string | undefined) {
			assert.equal(key, "cssTheme");
			if (!options.keepConfig) config = value;
		},
	};
	const customCss = {
		theme: options.theme,
		styleEl,
		disabled: options.disabled ?? false,
		themes: options.installed === false ? {} : { "Blue Topaz": { name: "Blue Topaz" } },
		setTheme(name: string) {
			customCss.theme = name;
			vault.setConfig("cssTheme", name);
		},
		async loadTheme() {
			await Promise.resolve();
			styleEl.textContent =
				!customCss.disabled && Object.prototype.hasOwnProperty.call(customCss.themes, customCss.theme)
					? (options.css ?? BLUE_TOPAZ_CSS)
					: "";
		},
	};
	const app = { customCss, vault };
	Object.defineProperty(globalThis, "app", { configurable: true, writable: true, value: app });
	return app;
}

function themeError(expected: string[], stylesheet: string) {
	return (error: unknown) => {
		assert.ok(error instanceof Error);
		for (const value of expected) assert.ok(error.message.includes(value), error.message);
		assert.ok(error.message.includes(String(stylesheet.length)), error.message);
		assert.ok(error.message.includes(sha256(stylesheet)), error.message);
		if (stylesheet) assert.ok(!error.message.includes(stylesheet), "the error must not include stylesheet text");
		return true;
	};
}

test("selecting the default theme empties the stylesheet and passes", async (t) => {
	const app = fakeApp(t, { theme: "Blue Topaz", config: "Blue Topaz" });
	const setTheme = t.mock.method(app.customCss, "setTheme");
	const loadTheme = t.mock.method(app.customCss, "loadTheme");
	await selectCssTheme({ cssTheme: "" });
	assert.equal(app.customCss.theme, "");
	assert.equal(app.vault.getConfig("cssTheme"), "");
	assert.equal(app.customCss.styleEl.textContent, "");
	assert.equal(setTheme.mock.callCount(), 1);
	assert.deepEqual(setTheme.mock.calls[0].arguments, [""]);
	assert.equal(loadTheme.mock.callCount(), 1);
});

test("a vault that never set cssTheme passes for the default theme", async (t) => {
	const app = fakeApp(t, { theme: "", config: undefined });
	const setTheme = t.mock.method(app.customCss, "setTheme");
	const loadTheme = t.mock.method(app.customCss, "loadTheme");
	await selectCssTheme({ cssTheme: "" });
	assert.equal(app.vault.getConfig("cssTheme"), undefined);
	assert.equal(app.customCss.styleEl.textContent, "");
	assert.equal(setTheme.mock.callCount(), 0);
	assert.equal(loadTheme.mock.callCount(), 1);
});

test("selecting Blue Topaz with the pinned sha256 passes", async (t) => {
	const app = fakeApp(t, { theme: "", config: "" });
	const setTheme = t.mock.method(app.customCss, "setTheme");
	const loadTheme = t.mock.method(app.customCss, "loadTheme");
	await selectCssTheme({ cssTheme: "Blue Topaz", sha256: sha256(BLUE_TOPAZ_CSS) });
	assert.equal(app.customCss.theme, "Blue Topaz");
	assert.equal(app.vault.getConfig("cssTheme"), "Blue Topaz");
	assert.equal(app.customCss.styleEl.textContent, BLUE_TOPAZ_CSS);
	assert.equal(setTheme.mock.callCount(), 1);
	assert.deepEqual(setTheme.mock.calls[0].arguments, ["Blue Topaz"]);
	assert.equal(loadTheme.mock.callCount(), 1);
});

test("a theme that loads as empty text is an error, not the default theme", async (t) => {
	const app = fakeApp(t, { theme: "Blue Topaz", config: "Blue Topaz", installed: false });
	for (const disabled of [false, true]) {
		app.customCss.disabled = disabled;
		if (disabled) app.customCss.themes = { "Blue Topaz": { name: "Blue Topaz" } };
		await assert.rejects(
			selectCssTheme({ cssTheme: "Blue Topaz", sha256: sha256(BLUE_TOPAZ_CSS) }),
			themeError(["Blue Topaz", sha256(BLUE_TOPAZ_CSS)], ""),
		);
		assert.equal(app.customCss.theme, "Blue Topaz");
		assert.equal(app.vault.getConfig("cssTheme"), "Blue Topaz");
		assert.equal(app.customCss.styleEl.textContent, "");
	}
});

test("a stylesheet with another sha256 is an error", async (t) => {
	const css = "body { color: rgb(4, 5, 6); } /* different theme bytes */";
	fakeApp(t, { theme: "Blue Topaz", config: "Blue Topaz", css });
	await assert.rejects(
		selectCssTheme({ cssTheme: "Blue Topaz", sha256: sha256(BLUE_TOPAZ_CSS) }),
		themeError(["Blue Topaz", sha256(BLUE_TOPAZ_CSS)], css),
	);
	await assert.rejects(selectCssTheme({ cssTheme: "Blue Topaz" }), { name: "Error" });
});

test("a config that did not change is an error", async (t) => {
	const app = fakeApp(t, { theme: "Old Theme", config: "Old Theme", keepConfig: true });
	await assert.rejects(
		selectCssTheme({ cssTheme: "Blue Topaz", sha256: sha256(BLUE_TOPAZ_CSS) }),
		themeError(["Blue Topaz", "Old Theme", sha256(BLUE_TOPAZ_CSS)], BLUE_TOPAZ_CSS),
	);
	assert.equal(app.customCss.theme, "Blue Topaz");
	assert.equal(app.vault.getConfig("cssTheme"), "Old Theme");
});
