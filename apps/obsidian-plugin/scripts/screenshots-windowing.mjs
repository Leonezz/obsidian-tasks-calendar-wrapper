/** Same-build viewport parity at both benchmark scales; no screenshots or stored baselines are involved. */
export const WINDOWING_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };
export const WINDOWING_POSITIONS = ["top", "today", "bottom"];

/** A fresh fixture view must open at the top before any explicit position alignment can conceal a scroll. */
export function compareOpeningScroll(arm, opening) {
	return Math.abs(opening.scrollTop) <= 0.5
		? []
		: [{ kind: "opening", detail: `${arm} opened at scrollTop=${opening.scrollTop}; expected 0 (±0.5 px)` }];
}

/** Runs in the fixture's own window, and reads text only after a row intersects the actual clipped viewport. */
export function collectViewportRows({ container }) {
	const content = document.querySelector(container);
	const root = content?.querySelector(".taskido");
	if (!content || !root) throw new Error("the timeline has no viewport or .taskido element");
	const win = content.ownerDocument.defaultView;
	const contentRect = content.getBoundingClientRect();
	const viewport = {
		left: Math.max(0, contentRect.left + content.clientLeft),
		top: Math.max(0, contentRect.top + content.clientTop),
		right: Math.min(win.innerWidth, contentRect.left + content.clientLeft + content.clientWidth),
		bottom: Math.min(win.innerHeight, contentRect.top + content.clientTop + content.clientHeight),
	};
	const clip = (rect, ancestor) => {
		const style = win.getComputedStyle(ancestor);
		if (style.overflowX === "visible" && style.overflowY === "visible") return;
		const box = ancestor.getBoundingClientRect();
		if (style.overflowX !== "visible") {
			rect.left = Math.max(rect.left, box.left + ancestor.clientLeft);
			rect.right = Math.min(rect.right, box.left + ancestor.clientLeft + ancestor.clientWidth);
		}
		if (style.overflowY !== "visible") {
			rect.top = Math.max(rect.top, box.top + ancestor.clientTop);
			rect.bottom = Math.min(rect.bottom, box.top + ancestor.clientTop + ancestor.clientHeight);
		}
	};
	for (let ancestor = content.parentElement; ancestor; ancestor = ancestor.parentElement) clip(viewport, ancestor);
	if (!(viewport.right > viewport.left && viewport.bottom > viewport.top))
		throw new Error(`the timeline viewport has no positive area: ${JSON.stringify(viewport)}`);
	const elements = [...root.querySelectorAll('.task[role="listitem"]')];
	const rows = [];
	for (const element of elements) {
		const box = element.getBoundingClientRect();
		const rect = {
			left: Math.max(box.left, viewport.left),
			top: Math.max(box.top, viewport.top),
			right: Math.min(box.right, viewport.right),
			bottom: Math.min(box.bottom, viewport.bottom),
		};
		if (!(rect.right > rect.left && rect.bottom > rect.top)) continue;
		if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
		for (let ancestor = element.parentElement; ancestor && ancestor !== content; ancestor = ancestor.parentElement)
			clip(rect, ancestor);
		if (!(rect.right > rect.left && rect.bottom > rect.top)) continue;
		const path = element.getAttribute("data-link");
		const lineText = element.getAttribute("data-line");
		const textId = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)[0];
		const day =
			element.closest("[data-tcw-day]")?.getAttribute("data-tcw-day") ??
			/-(-?\d{4,}-\d\d-\d\d)-.*-text$/.exec(textId)?.[1];
		if (!day || path === null || lineText === null || !/^\d+$/.test(lineText))
			throw new Error(`a viewport row has no stable day/path/line identity: ${element.outerHTML.slice(0, 600)}`);
		rows.push({
			day,
			path,
			line: Number(lineText),
			text: (element.querySelector(".lines")?.innerText ?? element.innerText).replace(/\s+/g, " ").trim(),
			status: element.getAttribute("data-task"),
			rect,
		});
	}
	return {
		viewport,
		scrollTop: content.scrollTop,
		scrollHeight: content.scrollHeight,
		mountedRows: elements.length,
		windowed: root.classList.contains("tcw-windowed"),
		rows,
	};
}

/** Compares instance identity and text in DOM order, rejecting empty, unwindowed or accidentally full-DOM trials. */
export function compareViewportRows(base, windowed) {
	const problems = [];
	if (base.windowed) problems.push({ kind: "mode", detail: "the Infinity arm still uses the windowed path" });
	if (!windowed.windowed) problems.push({ kind: "mode", detail: "the default arm does not use the windowed path" });
	for (const [arm, sample] of [
		["Infinity", base],
		["default", windowed],
	])
		if (sample.windowed !== sample.logicalWindowed)
			problems.push({ kind: "mode", detail: `${arm} DOM mode disagrees with the committed windowing state` });
	if (!base.rows.length || !windowed.rows.length)
		problems.push({ kind: "empty", detail: "both arms must have a row with positive viewport intersection" });
	if (!(base.rowCount > 0) || base.mountedRows !== base.rowCount || windowed.rowCount !== base.rowCount)
		problems.push({
			kind: "mounted",
			detail: `full instance counts: Infinity ${base.mountedRows}/${base.rowCount}, default ${windowed.mountedRows}/${windowed.rowCount}`,
		});
	if (!(windowed.mountedRows < windowed.rowCount))
		problems.push({
			kind: "mounted",
			detail: `default mounts ${windowed.mountedRows} rows, not fewer than the full ${windowed.rowCount}`,
		});
	for (const dimension of ["width", "height"]) {
		const size = (sample) =>
			dimension === "width"
				? sample.viewport.right - sample.viewport.left
				: sample.viewport.bottom - sample.viewport.top;
		if (Math.abs(size(base) - size(windowed)) > 0.5)
			problems.push({ kind: "viewport", detail: `${dimension}: ${size(base)} became ${size(windowed)}` });
	}
	const identity = (row) => [row.day, row.path, row.line];
	for (const [arm, sample] of [
		["Infinity", base],
		["default", windowed],
	]) {
		const keys = sample.rows.map((row) => JSON.stringify(identity(row)));
		if (new Set(keys).size !== keys.length)
			problems.push({ kind: "duplicate", detail: `${arm} repeats a day/path/line instance in the viewport` });
	}
	const rowValue = (row) => row && [...identity(row), row.text, row.status];
	for (let index = 0; index < Math.max(base.rows.length, windowed.rows.length); index++) {
		const before = rowValue(base.rows[index]) ?? null;
		const after = rowValue(windowed.rows[index]) ?? null;
		if (JSON.stringify(before) !== JSON.stringify(after))
			problems.push({ kind: "row", index, base: before, windowed: after });
	}
	return problems;
}

/** Runs in Obsidian. The debug override is applied after enabling, before a new view's factory reads it. */
export async function windowingPage({ action, pluginId, viewType, arm, position, todayKey }) {
	const content = () => document.querySelector(`.workspace-leaf-content[data-type="${viewType}"] > .view-content`);
	const root = () => content()?.querySelector(".taskido");
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const frame = () => {
		const win = content()?.ownerDocument.defaultView ?? window;
		return Promise.race([
			new Promise((resolve) => win.requestAnimationFrame(resolve)),
			new Promise((resolve) => win.setTimeout(resolve, 100)),
		]);
	};
	const todayHeader = () =>
		root()?.querySelector(`[data-tcw-day="${CSS.escape(todayKey)}"] > .details > .dateLine`) ??
		root()?.querySelector(".details.today > .dateLine");
	const snapshot = () => {
		const target = content();
		const rect = target.getBoundingClientRect();
		const info = app.workspace.getLeavesOfType(viewType)[0]?.view.getWindowingInfo?.();
		if (!info || !Number.isInteger(info.rowCount) || info.rowCount < 0 || typeof info.windowed !== "boolean")
			throw new Error("the timeline has no committed getWindowingInfo() row count");
		return {
			scrollTop: target.scrollTop,
			scrollHeight: target.scrollHeight,
			clientHeight: target.clientHeight,
			clientWidth: target.clientWidth,
			top: rect.top + target.clientTop,
			mountedRows: root()?.querySelectorAll('.task[role="listitem"]').length ?? 0,
			windowed: root()?.classList.contains("tcw-windowed") ?? false,
			rowCount: info.rowCount,
			logicalWindowed: info.windowed,
		};
	};
	async function settle(alignment, minMs = 250) {
		const target = content();
		if (!target || !root()) throw new Error("the timeline has not opened");
		await target.ownerDocument.fonts.ready;
		let lastMutation = performance.now();
		const observer = new target.ownerDocument.defaultView.MutationObserver(() => {
			lastMutation = performance.now();
		});
		observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true });
		const start = performance.now();
		let stableSince = start;
		let previous;
		let measured;
		try {
			for (;;) {
				measured = snapshot();
				let aligned = true;
				if (alignment === "top") {
					aligned = Math.abs(target.scrollTop) <= 0.5;
					if (!aligned) target.scrollTop = 0;
				} else if (alignment === "bottom") {
					const end = Math.max(0, target.scrollHeight - target.clientHeight);
					aligned = Math.abs(target.scrollTop - end) <= 0.5;
					if (!aligned) target.scrollTop = end;
				} else if (alignment === "today") {
					const header = todayHeader();
					if (!header) throw new Error(`the revealed day ${todayKey} has no real date line`);
					const delta = header.getBoundingClientRect().top - measured.top;
					aligned = Math.abs(delta) <= 0.5;
					if (!aligned) target.scrollTop += delta;
					measured.anchorText = header.innerText;
					measured.anchorDelta = delta;
				}
				const signature = JSON.stringify(measured);
				if (signature !== previous || !aligned) stableSince = performance.now();
				previous = signature;
				const now = performance.now();
				if (
					measured.mountedRows &&
					aligned &&
					now - start >= minMs &&
					now - Math.max(stableSince, lastMutation) >= 250
				)
					return { ...measured, settledMs: now - start };
				if (now - start > 60_000)
					throw new Error(
						`the ${alignment ?? "opening"} viewport did not settle in 60 s: ${JSON.stringify(measured)}`,
					);
				await frame();
				await wait(50);
			}
		} finally {
			observer.disconnect();
		}
	}
	if (action === "cleanup") {
		document.getElementById("tcw-windowing-parity")?.remove();
		return true;
	}
	if (action === "open") {
		app.workspace.detachLeavesOfType(viewType);
		if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
		if (!(await app.plugins.enablePlugin(pluginId))) throw new Error(`could not enable ${pluginId}`);
		const plugin = app.plugins.plugins[pluginId];
		if (!plugin?.debug || typeof plugin.debug !== "object")
			throw new Error("this build has no windowing debug override");
		if (arm === "off") plugin.debug.windowMinRows = Infinity;
		else if (arm === "default") delete plugin.debug.windowMinRows;
		else throw new Error(`unknown windowing arm ${arm}`);
		const others = [];
		app.workspace.iterateRootLeaves((leaf) => others.push(leaf));
		let leaf;
		try {
			leaf = app.workspace.getLeaf("tab");
		} catch (error) {
			if (error?.message !== "No tab group found.") throw error;
			leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0);
		}
		await leaf.setViewState({ type: viewType, active: true });
		others.filter((other) => other !== leaf).forEach((other) => other.detach());
		app.workspace.leftSplit.collapse();
		app.workspace.rightSplit.collapse();
		if (!document.getElementById("tcw-windowing-parity"))
			document.head.createEl("style", {
				attr: { id: "tcw-windowing-parity" },
				text: ".status-bar { display: none !important; }",
			});
		// setViewState can finish before React's first commit. Wait for that commit and the delayed options push.
		await wait(1_500);
		const opened = app.workspace.getLeavesOfType(viewType)[0]?.view;
		if (typeof opened?.getWindowingInfo !== "function") throw new Error("this build has no getWindowingInfo()");
		const started = performance.now();
		while (!root() || !opened.getWindowingInfo()) {
			if (performance.now() - started > 60_000)
				throw new Error("the timeline did not commit its first arrangement in 60 s");
			await frame();
			await wait(50);
		}
		return settle(undefined);
	}
	if (action === "position") {
		if (!["top", "today", "bottom"].includes(position)) throw new Error(`unknown viewport position ${position}`);
		if (position === "today") {
			const view = app.workspace.getLeavesOfType(viewType)[0]?.view;
			if (typeof view?.revealDay !== "function" || !(await view.revealDay(todayKey)))
				throw new Error(`the timeline could not reveal day ${todayKey}`);
		}
		return settle(position);
	}
	throw new Error(`unknown windowing page action ${action}`);
}
