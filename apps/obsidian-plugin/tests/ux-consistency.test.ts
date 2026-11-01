import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { OPTIONS_DELAY_MS } from "../utils/refresh";

/** The runner starts in apps/obsidian-plugin, including when invoked from the monorepo root. */
function coveredBy(file: string, name: string): void {
	const declaration = `test(${JSON.stringify(name)},`;
	assert.ok(
		readFileSync(file, "utf8")
			.split(/\r?\n/)
			.some((line) => line.trimStart().startsWith(declaration)),
		`${file} must still contain ${declaration}`,
	);
}

function filesIn(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") return [];
		const file = path.join(directory, entry.name);
		return entry.isDirectory() ? filesIn(file) : [file];
	});
}

// 设置 (l.223–225) | 884 行手写 UI，标题大小写不一，约 40 项平铺在 3 个标题下 | 一份带类型的设置 schema（key、默认值、文案、控件类型、分组）生成设置页；按“数据来源 / 显示 / 新建任务 / 高级”分组；句子式大小写；修改即时生效
describe("Settings", () => {
	// Phase 4 steps 13 and 14: the schema drives the settings generator.
	it.todo("the typed settings schema generates the settings page");
	// Phase 4 step 14: only the generator constructs settings controls.
	it.todo("no new Setting is constructed outside the settings generator");
	// Phase 4 step 14: render the four schema groups.
	it.todo("settings are grouped into Sources, Display, New tasks and Advanced");
	// Phase 4 step 14: use sentence case for the generated settings page.
	it.todo("settings headings and labels use sentence case");
	// Phase 4 step 14: display schema validation beside the affected control.
	it.todo("a wrong-typed setting is shown in place");
	// Phase 4 step 14, open question 2: explain delayed application beside the control.
	it.todo("viewOpen settings say that they apply when the view opens");
	// Phase 4 step 14, open question 2: explain delayed application beside the control.
	it.todo("pluginLoad settings say that they apply when the plugin loads");
	// Phase 4 step 12: settings copy comes from the shared copy table.
	it.todo("settings copy comes from the string table");
	it("push settings reach open views within 200 ms", () => {
		assert.ok(OPTIONS_DELAY_MS <= 200);
		coveredBy(
			"tests/optionupdates.test.ts",
			"a changed setting reaches the views after a short pause, not after 5 seconds",
		);
		coveredBy(
			"tests/plugin.test.ts",
			"changed options reach the timelines 200 ms after the last change, once a burst, as they are then",
		);
	});
});

// 任务操作 (l.226–228) | 勾选完成会打开源文件并抢走焦点 | 在时间线内原地完成、取消、改日期，写入格式与 Tasks 插件一致（完成日期、重复任务生成下一条）；“打开源文件”变成显式操作
describe("Task actions", () => {
	it("tasks can be completed in place", () => {
		coveredBy("tests/render.dom.test.ts", "with the setting off, the checkbox still writes through the writer");
	});
	// 阶段 3 第 11 步，用户决定不做。Phase 4 step 27 accepts this exception (open question 19).
	it("tasks can be cancelled in place", { skip: "phase 3 step 11: the user decided not to do it" }, () => {});
	it("task dates can be changed in place", () => {
		coveredBy("tests/rowmenu.test.ts", "each menu item writes its field and reports the shifted target");
		coveredBy(
			"tests/datemodal.test.ts",
			"the bridge's default modal saves only while in-place changes remain enabled",
		);
	});
	it("task writes match Tasks, including completion dates and recurring occurrences", () => {
		coveredBy("../../packages/core/tests/tasksparity.test.ts", "the Tasks capture covers the corpus");
		coveredBy(
			"../../packages/core/tests/tasksparity.test.ts",
			"toggleTaskLine matches Tasks byte for byte on the lines it rewrites with Tasks' defaults",
		);
		coveredBy("tests/render.dom.test.ts", "recurring completion then Undo keeps both shifts");
	});
	it("opening a note is an explicit action", () => {
		coveredBy(
			"tests/render.dom.test.ts",
			"with the setting on, clicking a checkbox opens the note once and does not call the writer",
		);
		coveredBy("tests/render.dom.test.ts", "✏️ does not open the note through the row");
		coveredBy(
			"tests/render.dom.test.ts",
			"date badge clicks pick due, scheduled and start without opening the note",
		);
		coveredBy("tests/opennote.test.ts", "opens once at the line");
	});
});

// 反馈与确认 (l.229–231) | 浏览器 confirm()、英文 Notice 文案各写各的 | Obsidian Modal 做确认；统一的错误报告函数；文案集中在一个字符串表，为中文等本地化留口
describe("Feedback and confirmation", () => {
	it("confirmation uses an Obsidian Modal instead of the browser dialog", () => {
		for (const file of ["src", "timeline", "utils"].flatMap(filesIn).filter((file) => /\.tsx?$/.test(file))) {
			// ConfirmModal's comments describe the browser dialog it replaces.
			const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");
			assert.doesNotMatch(source, /\bconfirm\s*\(|\bwindow\s*\.\s*confirm\b/, file);
		}
		coveredBy("tests/confirmmodal.test.ts", "pressing the confirm button closes the dialog and answers yes");
		coveredBy("tests/confirmmodal.test.ts", "pressing cancel answers no");
		coveredBy("tests/confirmmodal.test.ts", "closing the dialog any other way, such as with Escape, answers no");
	});
	// Phase 4 step 11: route errors through one reporter.
	it.todo("errors use one report function");
	// Phase 4 step 11, then steps 12 and 14 for settings: centralize all user-facing copy.
	it.todo("user-facing copy comes from one string table");
	// Phase 4 step 11: give the copy table a type usable by later translations.
	it.todo("the string table has a Copy type for translations");
});

// 视觉 (l.232–234) | 重复类名抢优先级，另有一份废弃 CSS | 以 Obsidian CSS 变量定义的一组 token（状态色、间距、徽标），组件只用 token；在默认主题与常见主题（如 README 提到的 Blue Topaz）下截图对比
describe("Visual", () => {
	it("the plugin has only one stylesheet", () => {
		assert.deepEqual(
			filesIn(".")
				.filter((file) => file.endsWith(".css"))
				.sort(),
			["styles.css"],
		);
	});
	// Phase 4 step 22: define the status, spacing and badge tokens.
	it.todo("status colors, spacing and badges have defined tokens");
	// Phase 4 step 22: replace component literals with tokens.
	it.todo("components use only tokens");
	// Phase 4 steps 22 and 26: use Obsidian variables; record the open question 19 exception if 26 is declined.
	it.todo("tokens are defined with Obsidian CSS variables");
	// Phase 4 step 23: remove repeated specificity prefixes.
	it.todo("selectors have no repeated specificity prefixes");
	// Phase 4 step 0b: compare the default theme screenshots and computed styles against the base.
	it.todo("default theme screenshots are compared against the base");
	// Phase 4 step 0c: add the Blue Topaz theme to the same comparison.
	it.todo("Blue Topaz screenshots are compared against the base");
});

// 平台 (l.235–237) | 移动端可用但未专门适配 | 定义移动端的最小可用范围（触控区域、无悬停交互），移动端继续支持
describe("Platform", () => {
	// Phase 4 step 16: set and verify the mobile target size.
	it.todo("mobile touch targets are at least 44 px");
	// Phase 4 step 16: expose every mobile action without hover.
	it.todo("mobile interactions have no hover-only effects");
});

// 可访问性 (l.238–240) | 图标按钮没有统一的标签与键盘操作 | 按钮带 aria-label，任务行可用键盘切换完成
describe("Accessibility", () => {
	// Phase 4 step 15: label every icon button.
	it.todo("icon buttons have aria-labels");
	// Phase 4 step 15: make a task row's completion action keyboard accessible.
	it.todo("a task row can be toggled with the keyboard");
});

// 解析行为的一致性由 fixtures/ 里的黄金样例保证：同一种任务写法在每个版本都应解析出同样的日期和状态。
describe("Parsing consistency", () => {
	it("golden bytes preserve parsed dates and statuses across versions", () => {
		coveredBy("tests/golden.test.ts", "golden: every task's parsed fields");
		coveredBy("tests/golden.test.ts", "golden: every snapshot file is one a test produces");
	});
});
