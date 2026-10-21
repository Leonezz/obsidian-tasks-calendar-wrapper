/**
 * The code bench.mjs runs in Obsidian, one measurement per call. fixtureCli sends it as source, so it can use nothing
 * from this file or any other; what it returns is summed up in bench.mjs and bench-results.mjs.
 */

/**
 * Runs in Obsidian: one measurement. Times are milliseconds from the start of the measured action. The waits give up
 * after `slowness` times as long, the vault's scale; how long the timeline must stay quiet does not grow, as quiet
 * counts from the last paint and the last long task.
 */
export async function measure({
	action,
	viewType,
	pluginId,
	command,
	path,
	content,
	token,
	quietMs,
	windowMs,
	settleMs,
	slowness = 1,
}) {
	const leafSelector = `.workspace-leaf-content[data-type="${viewType}"]`;
	// The timeline itself, without the view header, whose buttons Obsidian updates on its own.
	const contentSelector = `${leafSelector} > .view-content`;
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	async function until(condition, timeoutMs, what) {
		const start = performance.now();
		const limit = timeoutMs * slowness;
		while (!condition()) {
			if (performance.now() - start > limit)
				throw new Error(`timed out after ${limit / 1000} s waiting for ${what}`);
			await sleep(20);
		}
	}
	const sum = (tasks) => ({
		blockedMs: tasks.reduce((total, task) => total + task.duration, 0),
		longestMs: Math.max(0, ...tasks.map((task) => task.duration)),
		longTasks: tasks.length,
	});
	/**
	 * Records the long tasks, and the changes to the timeline's DOM: their times, when task rows first show up, when the
	 * token does, and the frames that showed them. A change is on screen once the browser has laid out and painted the
	 * frame after it, which for thousands of new rows takes longer than the change itself.
	 */
	function record(root) {
		const longTasks = [];
		const performanceObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration });
		});
		performanceObserver.observe({ type: "longtask" });
		const seen = { first: null, last: null, token: null, times: [], rowsAt: null, frames: [] };
		const liveRows = document.getElementsByClassName("task");
		const inView = (node) =>
			(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(contentSelector);
		let framePending = false;
		// The frame's animation callbacks run before it is laid out and painted, a timer after; changes made before the
		// callbacks are in that frame.
		const watchFrame = () => {
			if (framePending) return;
			framePending = true;
			requestAnimationFrame(() => {
				framePending = false;
				const startedAt = performance.now();
				setTimeout(() => seen.frames.push({ startedAt, paintedAt: performance.now() }), 0);
			});
		};
		const text = (change) =>
			change.type === "characterData"
				? change.target.data
				: [...change.addedNodes].map((node) => node.textContent).join(" ");
		const mutationObserver = new MutationObserver((changes) => {
			const now = performance.now();
			const relevant = changes.filter((change) => inView(change.target));
			if (relevant.length === 0) return;
			seen.first ??= now;
			seen.last = now;
			seen.times.push(now);
			watchFrame();
			if (seen.rowsAt === null && [...liveRows].some((row) => row.closest(contentSelector))) seen.rowsAt = now;
			if (token && seen.token === null && relevant.some((change) => text(change).includes(token)))
				seen.token = now;
		});
		mutationObserver.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
		let work = null;
		return {
			seen,
			/** When the last long task reported so far ended, or 0. */
			busyUntil() {
				for (const entry of performanceObserver.takeRecords())
					longTasks.push({ start: entry.startTime, duration: entry.duration });
				return Math.max(0, ...longTasks.map((task) => task.start + task.duration));
			},
			/** Stops recording and sums the long tasks that started at `from` or later. Later calls return the same. */
			stop(from) {
				if (work) return work;
				for (const entry of performanceObserver.takeRecords())
					longTasks.push({ start: entry.startTime, duration: entry.duration });
				performanceObserver.disconnect();
				mutationObserver.disconnect();
				work = sum(longTasks.filter((task) => task.start >= from));
				work.tasks = longTasks;
				return work;
			},
		};
	}
	/**
	 * Counts the calls of the open view's onReloadTasks, if it has one, as an unchanged list reloads without changing
	 * the DOM. Returns a function that undoes the counting and returns the count, or null without that method.
	 */
	function countReloads() {
		const view = app.workspace.getLeavesOfType(viewType)[0]?.view;
		if (typeof view?.onReloadTasks !== "function") return () => null;
		const own = Object.prototype.hasOwnProperty.call(view, "onReloadTasks");
		const original = view.onReloadTasks;
		let calls = 0;
		view.onReloadTasks = function (...args) {
			calls++;
			return original.apply(this, args);
		};
		return () => {
			if (own) view.onReloadTasks = original;
			else delete view.onReloadTasks;
			return calls;
		};
	}
	/**
	 * Counts the calls of vault.cachedRead, which the plugin reads notes with. Obsidian's File recovery calls it too, for
	 * an edited note at most every few minutes. Returns a function that undoes the counting and returns the count.
	 */
	function countReads() {
		const vault = app.vault;
		const own = Object.prototype.hasOwnProperty.call(vault, "cachedRead");
		const original = vault.cachedRead;
		let reads = 0;
		vault.cachedRead = function (...args) {
			reads++;
			return original.apply(this, args);
		};
		return () => {
			if (own) vault.cachedRead = original;
			else delete vault.cachedRead;
			return reads;
		};
	}
	/**
	 * Whether the timeline has not changed for `ms` since the frame showing its last change was painted, and the main
	 * thread has had no long task for as long. Counting from the change itself would not do in the large vault: laying
	 * out a render, or a reload before the next render, takes longer than `ms` there.
	 */
	const quietFor = (recorder, ms) => () => {
		const { seen } = recorder;
		if (seen.last === null) return false;
		const frame = seen.frames.find((candidate) => candidate.startedAt >= seen.last);
		return frame !== undefined && performance.now() - Math.max(frame.paintedAt, recorder.busyUntil()) >= ms;
	};
	/** When the frame that shows the changes made up to `time` was painted. */
	function paintedAfter(seen, time) {
		const frame = seen.frames.find((candidate) => candidate.startedAt >= time);
		if (!frame) throw new Error("no frame was painted after the timeline changed");
		return frame.paintedAt;
	}
	const rows = () => document.querySelectorAll(`${leafSelector} .task`).length;

	switch (action) {
		case "unload": {
			app.workspace.detachLeavesOfType(viewType);
			if (app.plugins.plugins[pluginId]) await app.plugins.disablePlugin(pluginId);
			await sleep(1_000 * slowness);
			return true;
		}
		case "load": {
			// The command opens the timeline in the right sidebar, where a collapsed sidebar would keep it from loading.
			app.workspace.rightSplit.expand();
			const recorder = record(document.body);
			const reads = countReads();
			const start = performance.now();
			try {
				if (!(await app.plugins.enablePlugin(pluginId)))
					throw new Error(`Obsidian could not load the plugin ${pluginId}`);
				if (!app.commands.executeCommandById(command)) throw new Error(`the command ${command} did not run`);
				await until(
					() =>
						recorder.seen.rowsAt !== null &&
						performance.now() - start >= settleMs &&
						quietFor(recorder, quietMs)(),
					60_000,
					"the timeline to render its task rows and stop changing",
				);
				const { seen } = recorder;
				const { tasks } = recorder.stop(start);
				// In milliseconds from enabling the plugin; bench-results.mjs splits them into renders.
				const since = (time) => time - start;
				return {
					rows: rows(),
					filesRead: reads(),
					rowsAt: seen.rowsAt === null ? null : since(seen.rowsAt),
					times: seen.times.map(since),
					frames: seen.frames.map((frame) => ({
						startedAt: since(frame.startedAt),
						paintedAt: since(frame.paintedAt),
					})),
					tasks: tasks
						.filter((task) => task.start >= start)
						.map((task) => ({ start: since(task.start), duration: task.duration })),
				};
			} finally {
				recorder.stop(start);
				reads();
			}
		}
		case "settle": {
			// Lets the reloads that follow loading the plugin pass, so they do not land in the next measurement.
			const recorder = record(document.body);
			try {
				await sleep(settleMs);
				await until(
					() => recorder.seen.last === null || quietFor(recorder, quietMs)(),
					30_000,
					"the timeline to stop changing",
				);
				return { rows: rows() };
			} finally {
				recorder.stop(0);
			}
		}
		case "save": {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(`the vault has no note ${path}`);
			const root = document.querySelector(leafSelector);
			if (!root) throw new Error("the timeline view is not open");
			const recorder = record(root);
			const reloadCalls = countReloads();
			const reads = countReads();
			let changed = null;
			const ref = app.metadataCache.on("changed", (changedFile) => {
				if (changedFile.path === path) changed ??= performance.now();
			});
			const start = performance.now();
			try {
				await app.vault.modify(file, content);
				const saved = performance.now();
				await until(() => changed !== null, 30_000, "Obsidian to read the saved note");
				if (token) {
					await until(() => recorder.seen.token !== null, 30_000, `the timeline to show "${token}"`);
					await until(quietFor(recorder, quietMs), 30_000, "the timeline to stop changing");
				} else {
					await sleep(windowMs);
				}
				const { tasks, ...work } = recorder.stop(start);
				const calls = reloadCalls();
				return {
					savedMs: saved - start,
					indexedMs: changed - start,
					renderedMs:
						recorder.seen.token === null ? null : paintedAfter(recorder.seen, recorder.seen.token) - start,
					reloadCalls: calls,
					reloaded: recorder.seen.first !== null || calls > 0,
					filesRead: reads(),
					...work,
				};
			} finally {
				recorder.stop(start);
				reloadCalls();
				reads();
				app.metadataCache.offref(ref);
			}
		}
		case "optionChange": {
			const plugin = app.plugins.plugins[pluginId];
			if (!plugin) throw new Error(`the plugin ${pluginId} is not loaded`);
			const leaf = document.querySelector(leafSelector);
			if (!leaf) throw new Error("the timeline view is not open");
			const dataPath = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
			const saved = await app.vault.adapter.read(dataPath);
			const was = plugin.userOptions.useRelative;
			// The timeline shows the relative dates are off with a class on its root, see TimelineView.
			const shows = (useRelative) => () =>
				leaf.querySelector(".taskido")?.classList.contains("noRelative") === !useRelative;
			if (!shows(was)()) throw new Error("the timeline does not show the relative dates setting it has");
			// Obsidian passes changes of a plugin's data.json on only for plugins in the vault's list of enabled plugins,
			// which enablePlugin does not add it to. It is listed while the option changes, as for a user who turned it on,
			// so that onExternalSettingsChange can be called at all.
			const listed = app.plugins.enabledPlugins.has(pluginId);
			app.plugins.enabledPlugins.add(pluginId);
			let externalCalls = 0;
			const ownExternal = Object.prototype.hasOwnProperty.call(plugin, "onExternalSettingsChange");
			const external = plugin.onExternalSettingsChange;
			plugin.onExternalSettingsChange = function (...args) {
				externalCalls++;
				return external.apply(this, args);
			};
			const recorder = record(leaf);
			const reloadCalls = countReloads();
			const reads = countReads();
			// When the change that shows the setting was made: the frame after it is the one that shows it.
			let appliedAt = null;
			const classes = new MutationObserver(() => {
				if (appliedAt === null && shows(!was)()) appliedAt = performance.now();
			});
			classes.observe(leaf, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
			const start = performance.now();
			try {
				await plugin.writeOptions({ useRelative: !was });
				await until(() => appliedAt !== null, 10_000, "the timeline to show the changed setting");
				await until(quietFor(recorder, quietMs), 30_000, "the timeline to stop changing");
				const { tasks, ...work } = recorder.stop(start);
				return {
					appliedMs: paintedAfter(recorder.seen, appliedAt) - start,
					reloadCalls: reloadCalls(),
					filesRead: reads(),
					externalSettingsCalls: externalCalls,
					...work,
				};
			} finally {
				classes.disconnect();
				recorder.stop(start);
				reloadCalls();
				reads();
				await plugin.writeOptions({ useRelative: was });
				await until(shows(was), 10_000, "the timeline to show the setting as it was");
				if (!listed) app.plugins.enabledPlugins.delete(pluginId);
				if (ownExternal) plugin.onExternalSettingsChange = external;
				else delete plugin.onExternalSettingsChange;
				// The "saveOptions" action saved the options before, so changing one and back saves the same file.
				if ((await app.vault.adapter.read(dataPath)) !== saved)
					throw new Error(`${dataPath} is not as it was before the option change and its undo`);
			}
		}
		case "saveOptions": {
			// The fixture installs a data.json with some options, written its own way; writeOptions saves all of them as
			// Obsidian writes JSON. Saving once first lets each option change check that it leaves data.json as it was.
			const plugin = app.plugins.plugins[pluginId];
			if (!plugin) throw new Error(`the plugin ${pluginId} is not loaded`);
			await plugin.writeOptions({});
			return true;
		}
		case "restore": {
			const file = app.vault.getAbstractFileByPath(path);
			if (file && (await app.vault.read(file)) !== content) await app.vault.modify(file, content);
			return true;
		}
		default:
			throw new Error(`unknown action ${action}`);
	}
}
