import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { copy } from "@tasks-calendar-wrapper/core";
import { settingGroups } from "../src/settings-schema";
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
	it("the typed settings schema generates the settings page", () => {
		coveredBy(
			"tests/settingrows.test.ts",
			"the row model of each data.json shape lists the rows the tab shows, in order",
		);
	});
	it("no new Setting is constructed outside the settings generator", () => {
		for (const file of ["src", "timeline", "utils", "../../packages/ui/src", "../../packages/core/src"]
			.flatMap(filesIn)
			.filter((file) => /\.tsx?$/.test(file))) {
			const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");
			if (/\bnew\s+Setting\s*\(/.test(source))
				assert.ok(file.startsWith(`src${path.sep}settings${path.sep}`), file);
		}
	});
	it("settings are grouped into Sources, Display, New tasks and Advanced", () => {
		assert.deepEqual(Object.values(copy.settings.groups), ["Sources", "Display", "New tasks", "Advanced"]);
		assert.deepEqual(settingGroups, ["sources", "display", "newTasks", "advanced"]);
		coveredBy("tests/settingrows.test.ts", "the rows sit in the four approved groups, in the approved order");
	});
	it("settings headings and labels use sentence case", () => {
		coveredBy("tests/copy.test.ts", "settings copy follows the style guide");
	});
	it("a wrong-typed setting is shown in place", () => {
		coveredBy(
			"tests/settingrows.test.ts",
			"every data.json shape with a value of the wrong type shows the warning and Reset in that row",
		);
	});
	it("viewOpen settings say that they apply when the view opens", () => {
		coveredBy(
			"tests/settingrows.test.ts",
			"each setting read when a timeline opens or Obsidian starts says so in its description",
		);
	});
	it("pluginLoad settings say that they apply when the plugin loads", () => {
		coveredBy(
			"tests/settingrows.test.ts",
			"each setting read when a timeline opens or Obsidian starts says so in its description",
		);
	});
	// Phase 4 step 12: settings copy comes from the shared copy table.
	it("settings copy comes from the string table", () => {
		coveredBy("tests/settingsschema.test.ts", "every spec except control none has copy");
		coveredBy("tests/settingsschema.test.ts", "every dropdown option value is a value of the codec or type");
		coveredBy("tests/copy.test.ts", "no user-visible string literal is written outside copy.ts");
	});
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
	it("errors use one report function", () => {
		coveredBy("tests/copy.test.ts", "new Notice( appears only in notices.ts");
	});
	it("user-facing copy comes from one string table", () => {
		coveredBy("tests/copy.test.ts", "no user-visible string literal is written outside copy.ts");
		coveredBy("tests/copy.test.ts", "the copy table matches fixtures/copy/en.json");
	});
	it("the string table has a Copy type for translations", () => {
		coveredBy("tests/copy.test.ts", "parameterised copy are typed functions");
	});
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
	it("status colors, spacing and badges have defined tokens", () => {
		coveredBy("tests/stylesheet.test.ts", "status colors, spacing and badge tokens preserve their initial values");
		coveredBy(
			"tests/stylesheet.test.ts",
			"every tcw token reference is defined in a scoped rule or by the day component",
		);
	});
	// Phase 4 step 22: replace component literals with tokens.
	it("components use only tokens", () => {
		coveredBy(
			"../../packages/ui/tests/inlinestyle.test.ts",
			"components set only custom properties in inline styles",
		);
	});
	// Phase 4 steps 22 and 26: use Obsidian variables; record the open question 19 exception if 26 is declined.
	it.todo("tokens are defined with Obsidian CSS variables");
	// Phase 4 step 23: remove repeated specificity prefixes.
	it.todo("selectors have no repeated specificity prefixes");
	// Phase 4 step 0b: compare the default theme screenshots and computed styles against the base.
	it("default theme screenshots are compared against the base", () => {
		coveredBy(
			"tests/screenshotsab.test.ts",
			"identical visible text, PNGs and styles report no differences and exit 0",
		);
		coveredBy("tests/screenshotsab.test.ts", "a style difference fails the A/B");
		coveredBy(
			"tests/screenshotstyles.test.ts",
			"the fingerprint is serialized with sorted keys, whatever the collection order",
		);
	});
	// Phase 4 step 0c: add the Blue Topaz theme to the same comparison.
	it("Blue Topaz screenshots are compared against the base", () => {
		coveredBy("tests/screenshotsab.test.ts", "a Blue Topaz style difference names its theme folder");
		coveredBy(
			"tests/screenshotthemes.test.ts",
			"a --themes=all plan takes 168 PNGs, 172 fingerprints and 42 visible",
		);
		coveredBy("tests/screenshotthemes.test.ts", "a theme.css with another sha256 is an error that names both");
	});
});

// 平台 (l.235–237) | 移动端可用但未专门适配 | 定义移动端的最小可用范围（触控区域、无悬停交互），移动端继续支持
describe("Platform", () => {
	// Phase 4 step 16: mobile CSS and screenshot measurements enforce the target size.
	it("mobile touch targets are at least 44 px", () => {
		coveredBy("tests/stylesheet.test.ts", "every touch target gets --tcw-touch-target only under .is-mobile");
		coveredBy(
			"tests/screenshotsmobile.test.ts",
			"a target below 44 px in either dimension fails the mobile profile",
		);
	});
	// Phase 4 step 16: hover is gated; packages/ui/tests/mobile.dom.test.ts pins the touch menu and names.
	it("mobile interactions have no hover-only effects", () => {
		coveredBy("tests/stylesheet.test.ts", "every :hover rule is inside @media (hover: hover)");
	});
});

// 可访问性 (l.238–240) | 图标按钮没有统一的标签与键盘操作 | 按钮带 aria-label，任务行可用键盘切换完成
describe("Accessibility", () => {
	it("icon buttons have aria-labels", () => {
		coveredBy("tests/a11y.dom.test.ts", "every interactive element is focusable and has an accessible name");
	});
	it("a task row can be toggled with the keyboard", () => {
		coveredBy("tests/a11y.dom.test.ts", "Space on a focused row writes the same edit as a click");
	});
});

// 解析行为的一致性由 fixtures/ 里的黄金样例保证：同一种任务写法在每个版本都应解析出同样的日期和状态。
describe("Parsing consistency", () => {
	it("golden bytes preserve parsed dates and statuses across versions", () => {
		coveredBy("tests/golden.test.ts", "golden: every task's parsed fields");
		coveredBy("tests/golden.test.ts", "golden: every snapshot file is one a test produces");
	});
});
