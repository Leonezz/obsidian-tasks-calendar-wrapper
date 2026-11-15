import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import {
	assertColdstartInventory,
	assertColdstartRestorable,
	assertNoColdstartLeftovers,
	awaitColdstartHost,
	backupColdstartFiles,
	coldstartDriverProcesses,
	coldstartHost,
	coldstartLayout,
	coldstartLayoutIdentity,
	coldstartReportPaths,
	collectColdstartSample,
	compareColdstartSamples,
	parseColdstartArgs,
	restoreColdstartFiles,
	startupNotReady,
	waitForColdstart,
	wrapColdstartBundle,
	type ColdstartInventory,
	type ColdstartSample,
} from "../scripts/coldstart-check.mjs";

const pin = { year: 2026, month: 0, day: 15 };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function temporary(t: TestContext) {
	const directory = mkdtempSync(path.join(os.tmpdir(), "tcw-coldstart-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return realpathSync(directory);
}

test("cold-start options fix the ten slots and reject unknown/repeated/unbounded arguments", () => {
	assert.deepEqual(parseColdstartArgs(["--report=/tmp/new-coldstart"]), {
		report: "/tmp/new-coldstart",
		timeoutMs: 180000,
	});
	assert.equal(parseColdstartArgs(["--report=a.json", "--timeout-ms=5000"]).timeoutMs, 5000);
	for (const args of [
		[],
		["--report="],
		["--report=a", "--rounds=1"],
		["--report=a", "--report=b"],
		["--report=a", "--timeout-ms=Infinity"],
		["--report=a", "--timeout-ms=4999"],
		["--report=a", "--timeout-ms=300001"],
	])
		assert.throws(() => parseColdstartArgs(args));
});

test("report guards reject existing files/directories and aliases into vaults before writing", (t) => {
	const directory = temporary(t);
	const fresh = path.join(directory, "review.json");
	assert.deepEqual(coldstartReportPaths(fresh), { file: fresh, directory: fresh + ".files" });
	const vault = path.join(directory, "fixture");
	mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
	const alias = path.join(directory, "alias");
	symlinkSync(vault, alias, "dir");
	assert.throws(() => coldstartReportPaths(path.join(alias, "missing", "report.json")), /outside vaults/);
	assert.equal(existsSync(path.join(vault, "missing")), false);
	writeFileSync(fresh, "existing report");
	assert.throws(() => coldstartReportPaths(fresh), /already exists/);
	const existing = path.join(directory, "existing");
	mkdirSync(existing);
	assert.throws(() => coldstartReportPaths(existing), /already exists/);
});

test("the real CJS wrapper preserves export descriptors and pins Base initialisation before setting its instance flag", () => {
	for (const skip of [false, true]) {
		const events: unknown[] = [];
		let locale = "zh-cn";
		const moment = { now: () => 123, locale: (next?: string) => (next ? (locale = next) : locale) };
		const source = `"use strict";
		class Plugin {
			constructor() { events.push(["base", window.moment.now(), window.moment.locale()]); this.debug = {}; }
			onload() { events.push(["onload", this.debug.skipOpenReread]); }
		}
		const original = Object.create(null);
		Object.defineProperties(original, {
			default: { get: () => Plugin, enumerable: true },
			other: { get: () => 42, enumerable: false, configurable: false },
			__esModule: { value: true }
		}); module.exports = original;`;
		const module = { exports: {} as Record<string, unknown> };
		const context = { module, events, window: { moment }, require: () => ({ randomUUID: () => "new-boot" }) };
		const wrapped = wrapColdstartBundle(source, skip, pin);
		assert.ok(wrapped.startsWith(source), "the original bundle, including strict directive, is untouched");
		runInNewContext(wrapped, context);
		assert.deepEqual(events, [], "injection does not construct a plugin or run onload");
		const exported = module.exports;
		assert.equal(Object.getPrototypeOf(exported), null);
		assert.equal(exported.other, 42);
		assert.deepEqual(Object.getOwnPropertyDescriptor(exported, "other"), {
			get: Object.getOwnPropertyDescriptor(exported, "other")!.get,
			set: undefined,
			enumerable: false,
			configurable: false,
		});
		const descriptor = Object.getOwnPropertyDescriptor(exported, "default")!;
		assert.equal(typeof descriptor.get, "function");
		assert.equal(descriptor.configurable, false);
		assert.equal(descriptor.enumerable, true);
		const plugin = new (exported.default as new () => { debug: { skipOpenReread: boolean }; onload(): void })();
		assert.equal(plugin.debug.skipOpenReread, skip);
		plugin.onload();
		assert.deepEqual(plain(events), [
			["base", new Date(2026, 0, 15, 12).getTime(), "en"],
			["onload", skip],
		]);
		assert.equal(
			(context.window as typeof context.window & { __tcwColdstartBuild: { sourceSha256: string } })
				.__tcwColdstartBuild.sourceSha256,
			digest(source),
		);
	}
});

function actualCollector() {
	const task = { id: "Tasks.md:3", path: "Tasks.md", line: 3 };
	const view = {
		timelineHandle: {
			result: {
				years: [
					{
						days: [
							{ key: "2026-01-14", tasks: [{ task }] },
							{ key: "2026-01-15", tasks: [{ task }] },
						],
					},
				],
			},
		},
		store: { getSnapshot: () => ({ tasks: [task], shown: [task] }) },
		viewState: { store: { getSnapshot: () => ({ counter: "", todayFocus: false }) } },
		getWindowingInfo: () => ({ rowCount: 2, windowed: false }),
		isReloading: false,
		reloadAgain: false,
		committedReloadId: 2,
		lastListReloadId: 2,
	};
	const moment = Object.assign(() => ({ format: () => "2026-01-15" }), { locale: () => "en" });
	const context = {
		app: {
			metadataCache: { initialized: true, inProgressTaskCount: 0 },
			vault: { adapter: { getBasePath: () => "/fixtures/golden-vault" } },
			plugins: { plugins: { test: { debug: { skipOpenReread: false } } } },
			workspace: { layoutReady: true, getLeavesOfType: () => [{ view }] },
		},
		window: { moment, __tcwColdstartBuild: { skipOpenReread: false, sourceSha256: "source", bootNonce: "boot" } },
		require: () => ({ process: { pid: 77 } }),
		process: { pid: 78, ppid: 77 },
	};
	const run = () =>
		runInNewContext(
			`(${collectColdstartSample.toString()})(${JSON.stringify({ pluginId: "test", viewType: "timeline", vaultPath: "/fixtures/golden-vault", skipOpenReread: false, sourceSha256: "source" })})`,
			context,
		) as ColdstartSample;
	return { view, context, run };
}

test("the real collector reads all committed day instances, even when windowing is inactive, not DOM or unique IDs", () => {
	const f = actualCollector();
	const sample = plain(f.run());
	assert.deepEqual(sample.rows, [
		{ day: "2026-01-14", id: "Tasks.md:3", path: "Tasks.md", line: 3 },
		{ day: "2026-01-15", id: "Tasks.md:3", path: "Tasks.md", line: 3 },
	]);
	assert.deepEqual(sample.taskIds, ["Tasks.md:3"]);
	assert.deepEqual(sample.shownIds, ["Tasks.md:3"]);
	assert.equal(sample.mainPid, 77);
	assert.equal(sample.bootNonce, "boot");
});

test("the real collector refuses missing controllers, pending commits, wrong filters/builds and row-count mismatch", () => {
	const pending = actualCollector();
	pending.view.committedReloadId = 1;
	assert.throws(pending.run, /NOT_READY/);
	pending.view.committedReloadId = 2;
	pending.view.reloadAgain = true;
	assert.throws(pending.run, /NOT_READY/);
	const missing = actualCollector();
	delete (missing.view as Partial<typeof missing.view>).timelineHandle;
	assert.throws(missing.run, /controller/);
	const mismatch = actualCollector();
	mismatch.view.getWindowingInfo = () => ({ rowCount: 1, windowed: false });
	assert.throws(mismatch.run, /row count/);
	const wrong = actualCollector();
	wrong.context.window.__tcwColdstartBuild.sourceSha256 = "stale";
	assert.throws(wrong.run, /identity/);
	const filtered = actualCollector();
	filtered.view.viewState.store.getSnapshot = () => ({ counter: "todoFilter", todayFocus: false });
	assert.throws(filtered.run, /controls must have no/);
	filtered.view.viewState.store.getSnapshot = () => ({
		counter: "",
		todayFocus: false,
		quickFilter: { priorities: [] },
	});
	assert.throws(filtered.run, /controls must have no/);
	const indexing = actualCollector();
	indexing.context.app.metadataCache.initialized = false;
	assert.throws(indexing.run, /NOT_READY: metadata/);
	indexing.context.app.metadataCache.initialized = true;
	indexing.context.app.metadataCache.inProgressTaskCount = 1;
	assert.throws(indexing.run, /NOT_READY: metadata/);
	delete (indexing.context.app as Partial<typeof indexing.context.app>).metadataCache;
	assert.throws(indexing.run, /readiness fields/);
	const empty = actualCollector();
	empty.view.timelineHandle.result.years = [];
	empty.view.getWindowingInfo = () => ({ rowCount: 0, windowed: false });
	assert.throws(empty.run, /must have nonempty/);
});

test("identity comparison checks the entire ordered row sequence and source/shown IDs, retaining duplicates", () => {
	const before = plain(actualCollector().run());
	const after = plain(before);
	after.mainPid++;
	after.bootNonce = "next-boot";
	compareColdstartSamples(before, after);
	for (const mutate of [
		(s: ColdstartSample) => s.rows.reverse(),
		(s: ColdstartSample) => {
			s.rows[1].line++;
		},
		(s: ColdstartSample) => {
			s.rows[1].id = "another";
		},
		(s: ColdstartSample) => {
			s.rows.pop();
		},
		(s: ColdstartSample) => {
			s.taskIds.push("missing-file:1");
		},
		(s: ColdstartSample) => {
			s.shownIds[0] = "another";
		},
	]) {
		const changed = plain(before);
		mutate(changed);
		assert.throws(() => compareColdstartSamples(before, changed));
	}
});

test("readiness polling is bounded and only retries explicitly allowed not-ready errors", () => {
	let time = 0;
	let calls = 0;
	const clock = {
		now: () => time,
		sleep: (ms: number) => {
			time += ms;
		},
	};
	assert.equal(
		waitForColdstart(() => ++calls === 3, 1000, "ready", clock),
		true,
	);
	assert.equal(calls, 3);
	assert.throws(() => waitForColdstart(() => false, 500, "ready", clock), /Timed out/);
	calls = 0;
	assert.throws(
		() =>
			waitForColdstart(
				() => {
					calls++;
					throw new Error("identity mismatch");
				},
				5000,
				"ready",
				clock,
			),
		/identity mismatch/,
	);
	assert.equal(calls, 1, "identity errors stop immediately rather than retrying a slot");
});

test("unknown app windows are rejected before any full snapshot, restoration or quit", async () => {
	for (const action of ["inventory", "quit"] as const) {
		let fullReads = 0;
		let mutations = 0;
		const wins = ["golden-vault", "bench-vault", "bench-vault-x10", "Personal"].map((name, id) => ({
			id,
			getTitle: () => `${name} - Obsidian`,
			webContents: {
				isDestroyed: () => false,
				isCrashed: () => false,
				isLoading: () => false,
				executeJavaScript: async (code: string) => {
					if (!code.includes("getLayout")) return JSON.stringify({ ok: true, value: `/fixtures/${name}` });
					fullReads++;
					throw new Error("must not read a full snapshot");
				},
			},
		}));
		const remote = { BrowserWindow: { getAllWindows: () => wins }, app: { quit: () => mutations++ } };
		const context = { require: () => remote, setTimeout: () => mutations++ };
		const args = {
			action,
			pluginId: "test",
			viewType: "timeline",
			expectedPaths: {
				"golden-vault": "/fixtures/golden-vault",
				"bench-vault": "/fixtures/bench-vault",
				"bench-vault-x10": "/fixtures/bench-vault-x10",
				"tasks-parity": "/fixtures/tasks-parity",
			},
			restore: { "/fixtures/Personal": {} },
		};
		await assert.rejects(
			runInNewContext(`(${coldstartHost.toString()})(${JSON.stringify(args)})`, context),
			/Unexpected app window title/,
		);
		assert.equal(fullReads, 0);
		assert.equal(mutations, 0);
	}
});

test("unknown paths with a fixture-looking title are rejected before full reads", async () => {
	let fullReads = 0;
	const remote = {
		BrowserWindow: {
			getAllWindows: () => [
				{
					id: 1,
					getTitle: () => "golden-vault - Obsidian",
					webContents: {
						isDestroyed: () => false,
						isCrashed: () => false,
						isLoading: () => false,
						executeJavaScript: async (code: string) => {
							if (!code.includes("getLayout"))
								return JSON.stringify({ ok: true, value: "/personal/golden-vault" });
							fullReads++;
						},
					},
				},
			],
		},
	};
	await assert.rejects(
		runInNewContext(
			`(${coldstartHost.toString()})(${JSON.stringify({ action: "inventory", expectedPaths: { "golden-vault": "/fixtures/golden-vault" } })})`,
			{ require: () => remote },
		),
		/Unexpected or duplicate fixture path/,
	);
	assert.equal(fullReads, 0);
});

test("startup metadata reads report NOT_READY before app/vault globals exist", async () => {
	for (const page of [{}, { app: {} }]) {
		const remote = {
			BrowserWindow: {
				getAllWindows: () => [
					{
						id: 1,
						getTitle: () => "golden-vault - Obsidian",
						webContents: {
							id: 2,
							isDestroyed: () => false,
							isCrashed: () => false,
							isLoading: () => false,
							executeJavaScript: async (code: string) => {
								try {
									return await runInNewContext(code, page);
								} catch {
									throw new Error(
										"Script failed to execute, this normally means an error was thrown.",
									);
								}
							},
						},
					},
				],
			},
		};
		await assert.rejects(
			runInNewContext(
				`(${coldstartHost.toString()})(${JSON.stringify({ action: "inventory", expectedPaths: { "golden-vault": "/fixtures/golden-vault" } })})`,
				{ require: () => remote },
			),
			/NOT_READY: vault identity/,
		);
	}
});

test("startup-only polling tolerates unregistered eval but preserves identity and actual collector failures", () => {
	const unregistered = new Error(
		'code run in Obsidian failed: Error: Command "eval" not found. It may require a plugin to be enabled.',
	);
	assert.equal(startupNotReady(unregistered), true);
	for (const message of [
		"Unexpected fixture path: personal",
		"Script failed to execute",
		"code run in Obsidian failed: Cold-start controls must have no counter",
		"the Obsidian CLI failed for eval: permission denied",
	])
		assert.equal(startupNotReady(new Error(message)), false);
	const paths = { "golden-vault": "/fixtures/golden-vault", "bench-vault-x10": "/fixtures/bench-vault-x10" };
	const ready = {
		mainPid: 88,
		callerWebContentsId: 1,
		windows: Object.entries(paths).map(([name, vaultPath], i) => ({
			name,
			vaultPath,
			mainPid: 88,
			parentPid: 88,
			webContentsId: i + 1,
			crashed: false,
			layoutReady: true,
			saved: false,
			jobs: i === 0 ? 1 : 0,
		})),
	} as ColdstartInventory;
	let time = 0;
	let calls = 0;
	const clock = {
		now: () => time,
		sleep: (ms: number) => {
			time += ms;
		},
	};
	assert.strictEqual(
		awaitColdstartHost(
			() => {
				calls++;
				if (calls === 1) throw unregistered;
				if (calls === 2) throw new Error("NOT_READY: fixture globals not ready");
				return ready;
			},
			paths,
			77,
			1000,
			clock,
		),
		ready,
	);
	assert.equal(calls, 3, "recovery must wait for the same complete verified host before scheduling quit");
	calls = 0;
	assert.throws(
		() =>
			awaitColdstartHost(
				() => {
					calls++;
					const foreign = plain(ready);
					foreign.windows[0].vaultPath = "/personal/golden-vault";
					return foreign;
				},
				paths,
				77,
				1000,
				clock,
			),
		/Fixture path changed/,
	);
	assert.equal(calls, 1);
});

test("cross-window JSON transport preserves a real hard page error instead of Electron's generic rejection", async () => {
	const remote = {
		BrowserWindow: {
			getAllWindows: () => [
				{
					id: 1,
					getTitle: () => "golden-vault - Obsidian",
					webContents: {
						id: 2,
						isDestroyed: () => false,
						isCrashed: () => false,
						isLoading: () => false,
						executeJavaScript: async (code: string) => {
							try {
								return await runInNewContext(code, {
									app: {
										vault: {
											adapter: {
												getBasePath: () => {
													throw new Error("Actual hard identity failure");
												},
											},
										},
									},
								});
							} catch {
								throw new Error("Script failed to execute");
							}
						},
					},
				},
			],
		},
	};
	await assert.rejects(
		runInNewContext(
			`(${coldstartHost.toString()})(${JSON.stringify({ action: "inventory", expectedPaths: { "golden-vault": "/fixtures/golden-vault" } })})`,
			{ require: () => remote },
		),
		/Actual hard identity failure/,
	);
});

test("the serialized delayed quit rechecks identities, including windows created during its awaited revalidation", async (t) => {
	for (const change of ["none", "after-schedule", "during-revalidation", "changed-path"] as const) {
		await t.test(change, async () => {
			let quits = 0;
			let callbacks = 0;
			let inject = false;
			let scheduled: (() => Promise<void>) | undefined;
			const state: { __tcwColdstartQuit?: { status: string; error?: string } } = {};
			const names = ["golden-vault", "bench-vault-x10"];
			const expectedPaths = Object.fromEntries(names.map((name) => [name, `/fixtures/${name}`]));
			const windows = names.map((name, id) => ({
				id,
				getTitle: () => `${name} - Obsidian`,
				webContents: {
					id: id + 10,
					isDestroyed: () => false,
					isCrashed: () => false,
					isLoading: () => false,
					executeJavaScript: async (code: string) => {
						assert.equal(code.includes("getLayout"), false, "quit guards read only identity metadata");
						if (inject) {
							inject = false;
							windows.push(foreign());
						}
						return JSON.stringify({
							ok: true,
							value: change === "changed-path" && callbacks ? `/personal/${name}` : expectedPaths[name],
						});
					},
				},
			}));
			function foreign(): (typeof windows)[number] {
				return {
					id: 90,
					getTitle: () => "Personal - Obsidian",
					webContents: {
						id: 91,
						isDestroyed: () => false,
						isCrashed: () => false,
						isLoading: () => false,
						executeJavaScript: async () => {
							throw new Error("Do not query a personal vault");
						},
					},
				};
			}
			const remote = {
				BrowserWindow: { getAllWindows: () => [...windows] },
				process: { pid: 77 },
				app: { quit: () => quits++ },
			};
			const context = {
				window: state,
				require: () => remote,
				setTimeout: (fn: () => Promise<void>) => {
					scheduled = fn;
				},
			};
			const request = await runInNewContext(
				`(${coldstartHost.toString()})(${JSON.stringify({ action: "quit", expectedPaths })})`,
				context,
			);
			assert.equal(request.scheduled, true);
			assert.equal(quits, 0, "returning a scheduled receipt is not a successful app quit");
			if (change === "after-schedule") windows.push(foreign());
			if (change === "during-revalidation") inject = true;
			callbacks++;
			await scheduled!();
			assert.equal(quits, change === "none" ? 1 : 0);
			assert.equal(state.__tcwColdstartQuit?.status, change === "none" ? "quitting" : "blocked");
			if (change !== "none") assert.match(state.__tcwColdstartQuit?.error ?? "", /Unexpected|identities changed/);
		});
	}
});

test("cold-only restoration requires persisted/runtime coherence but allows genuine deferred disabled leaves", () => {
	const id = "tasks-calendar-wrapper";
	const fixture = (name: string, enabled: string[], hasLeaf = false) => ({
		name,
		enabled,
		loaded: enabled,
		restricted: false,
		views: hasLeaf ? [{ id: "deferred", hasController: false, controls: null }] : [],
	});
	const inventory = {
		windows: [
			fixture("golden-vault", [id]),
			fixture("bench-vault", [], true),
			fixture("bench-vault-x10", []),
			fixture("tasks-parity", ["obsidian-tasks-plugin", id], true),
		],
	} as unknown as ColdstartInventory;
	const disk = Object.fromEntries(inventory.windows.map((win) => [win.name, [...win.enabled]]));
	assertColdstartRestorable(inventory, disk, id);
	for (const invalid of [null, {}, [id, id], [3], ["different-plugin"]])
		assert.throws(() => assertColdstartRestorable(inventory, { ...disk, "golden-vault": invalid }, id));
	const manual = plain(inventory);
	manual.windows[1].loaded = [id];
	assert.throws(() => assertColdstartRestorable(manual, disk, id), /Loaded plugins/);
	for (const controls of [null, { counter: "", todayFocus: false }]) {
		const stale = plain(inventory);
		stale.windows[1].views[0] = { id: "live", hasController: controls === null, controls };
		assert.throws(() => assertColdstartRestorable(stale, disk, id), /disabled plugin still has live/);
	}
	const restricted = plain(inventory);
	restricted.windows[3].restricted = true;
	restricted.windows[3].loaded = [];
	assertColdstartRestorable(restricted, disk, id);
	restricted.windows[3].loaded = [id];
	assert.throws(() => assertColdstartRestorable(restricted, disk, id), /Loaded plugins/);
});

test("plugin and appearance backup leftovers are rejected without recovering or deleting them", (t) => {
	const vault = path.join(temporary(t), "golden-vault");
	mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
	assertNoColdstartLeftovers(vault);
	for (const name of [".tcw-fixture-backup", ".tcw-fixture-appearance.json", ".tcw-fixture-appearance.json.tmp"]) {
		const file = path.join(vault, ".obsidian", name);
		writeFileSync(file, "previous run backup");
		assert.throws(() => assertNoColdstartLeftovers(vault), /earlier fixture backup/);
		assert.equal(readFileSync(file, "utf8"), "previous run backup");
		rmSync(file);
	}
});

test("driver detection excludes own ancestors and includes other permanent and temporary drivers", () => {
	const ps =
		"1 0 launchd\n20 1 node scripts/coldstart-check.mjs --report=a\n21 20 node /runner.js\n30 1 node scripts/bench.mjs\n31 1 node /tmp/tcw-native-check.mjs\n32 1 node scripts/screenshots.mjs\n33 1 node scripts/test.mjs";
	assert.deepEqual(
		coldstartDriverProcesses(ps, 21).map(({ pid }) => pid),
		[30, 31, 32],
	);
});

test("controlled layout changes only a validated existing leaf and its selected tab; sidebars/bounds remain intact", () => {
	const original = {
		main: {
			id: "main",
			type: "split",
			direction: "vertical",
			children: [
				{
					id: "tabs",
					type: "tabs",
					children: [{ id: "note", type: "leaf", state: { type: "markdown", state: { file: "Inbox.md" } } }],
				},
			],
		},
		left: { id: "left", type: "split", width: 301, children: [] },
		floating: { width: 900 },
		active: "note",
	};
	const controlled = coldstartLayout(original, "timeline");
	assert.deepEqual(controlled.left, original.left);
	assert.deepEqual(controlled.floating, original.floating);
	const restored = plain(controlled) as typeof original;
	restored.main.children[0].children[0].state = original.main.children[0].children[0].state;
	delete (restored.main.children[0] as (typeof restored.main.children)[0] & { currentTab?: number }).currentTab;
	assert.deepEqual(restored, original);
	assert.throws(() => coldstartLayout({ main: { id: "x", type: "mystery", children: [] } }, "timeline"));
	const saved = {
		main: {
			id: "main",
			type: "split",
			children: [
				{
					id: "v",
					type: "leaf",
					state: {
						type: "timeline",
						state: { v: 1, session: "old", counter: "todoFilter", todayFocus: true },
					},
				},
			],
		},
	};
	const identity = coldstartLayoutIdentity(saved, "timeline");
	assert.deepEqual(identity.sessions, [{ leafId: "v", session: "old" }]);
	assert.equal(JSON.stringify(identity.layout).includes('"counter":"todoFilter"'), true);
	assert.equal(JSON.stringify(identity.layout).includes('"todayFocus":true'), true);
	assert.equal(JSON.stringify(saved).includes('"session":"old"'), true, "raw layout is retained");
});

test("durable backups restore exact plugin/config bytes and absent files; corrupt backups fail before original mutation", (t) => {
	const directory = temporary(t);
	const vault = path.join(directory, "golden-vault");
	const config = path.join(vault, ".obsidian");
	const plugin = path.join(config, "plugins", "test");
	mkdirSync(path.join(plugin, "nested"), { recursive: true });
	writeFileSync(path.join(plugin, "nested", "data.bin"), Buffer.from([0, 255, 13, 10]));
	writeFileSync(path.join(config, "workspace.json"), '{\r\n\t"x":1\r\n}\r\n');
	const backupsDir = path.join(directory, "backup");
	mkdirSync(backupsDir);
	const vaults = { "golden-vault": vault };
	const backup = backupColdstartFiles(vaults, backupsDir, "test");
	writeFileSync(path.join(plugin, "main.js"), "temporary build");
	writeFileSync(path.join(config, "appearance.json"), "temporary");
	restoreColdstartFiles(vaults, backupsDir, backup, "test");
	assert.equal(existsSync(path.join(plugin, "main.js")), false);
	assert.equal(existsSync(path.join(config, "appearance.json")), false);
	assert.deepEqual(readFileSync(path.join(plugin, "nested", "data.bin")), Buffer.from([0, 255, 13, 10]));
	assert.equal(readFileSync(path.join(config, "workspace.json"), "utf8"), '{\r\n\t"x":1\r\n}\r\n');
	writeFileSync(path.join(backupsDir, "golden-vault", "workspace.json"), "corrupt");
	assert.throws(() => restoreColdstartFiles(vaults, backupsDir, backup, "test"), /backup changed/);
	assert.equal(readFileSync(path.join(config, "workspace.json"), "utf8"), '{\r\n\t"x":1\r\n}\r\n');
});

test("restoration removes an empty plugins directory that did not exist originally", (t) => {
	const directory = temporary(t);
	const vault = path.join(directory, "bench-vault-x10");
	const config = path.join(vault, ".obsidian");
	mkdirSync(config, { recursive: true });
	const backupDirectory = path.join(directory, "backup");
	mkdirSync(backupDirectory);
	const vaults = { "bench-vault-x10": vault };
	const backups = backupColdstartFiles(vaults, backupDirectory, "test");
	const plugin = path.join(config, "plugins", "test");
	mkdirSync(plugin, { recursive: true });
	writeFileSync(path.join(plugin, "main.js"), "temporary build");
	restoreColdstartFiles(vaults, backupDirectory, backups, "test");
	assert.equal(existsSync(path.join(config, "plugins")), false);
});

test("inventory rejects a foreign window, pending jobs, stale main PID and duplicate fixture identity", () => {
	const expectedPaths = { "golden-vault": "/fixtures/golden-vault", "bench-vault-x10": "/fixtures/bench-vault-x10" };
	const inventory = {
		mainPid: 77,
		callerWebContentsId: 1,
		windows: Object.entries(expectedPaths).map(([name, vaultPath], index) => ({
			name,
			vaultPath,
			mainPid: 77,
			parentPid: 77,
			webContentsId: index + 1,
			crashed: false,
			layoutReady: true,
			saved: false,
			jobs: index === 0 ? 1 : 0,
		})),
	} as ColdstartInventory;
	assertColdstartInventory(inventory, expectedPaths);
	for (const mutate of [
		(i: ColdstartInventory) => {
			i.windows[1].name = "personal";
		},
		(i: ColdstartInventory) => {
			i.windows[1].jobs = 1;
		},
		(i: ColdstartInventory) => {
			i.windows[1].parentPid = 4;
		},
		(i: ColdstartInventory) => {
			i.windows[1].name = "golden-vault";
		},
	]) {
		const changed = plain(inventory);
		mutate(changed);
		assert.throws(() => assertColdstartInventory(changed, expectedPaths));
	}
});
