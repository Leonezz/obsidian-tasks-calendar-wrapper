import { AbstractInputSuggest, TFile, TFolder, type App, type TextComponent } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { reportSaveError } from "../save";
import type { SettingsControlActions } from "../generate";
import type { SettingRowOf } from "../rows";
import type { Setting } from "obsidian";

type PathKind = "file" | "folder" | "path";

/** Suggestions never constrain free text: a path filter may be only part of a path. */
export class PathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly paths: () => readonly string[],
		private readonly picked: (value: string) => void,
	) {
		super(app, input);
		this.limit = 30;
	}

	protected getSuggestions(query: string): string[] {
		if (/[,\r\n]/.test(query)) return [];
		const wanted = query.trim().toLocaleLowerCase();
		return this.paths()
			.filter((path) => path.toLocaleLowerCase().includes(wanted))
			.slice(0, 30);
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path || copy.settings.tab.rootFolder);
	}

	selectSuggestion(path: string, evt?: MouseEvent | KeyboardEvent): void {
		if (evt && "isComposing" in evt && (evt.isComposing || evt.keyCode === 229)) return;
		evt?.preventDefault();
		evt?.stopPropagation();
		this.setValue(path);
		this.close();
		this.input.focus();
		this.picked(path);
	}
}

/** Read the vault only when a suggestion is requested, including folders without notes. */
export function vaultPaths(app: App, kind: PathKind): string[] {
	return [
		...new Set(
			app.vault.getAllLoadedFiles().flatMap((file) => {
				if (file instanceof TFolder) return kind === "file" ? [] : [file.path.replace(/^\/$|\/+$/g, "")];
				if (kind === "folder") return [];
				if (kind === "file" && (!(file instanceof TFile) || file.extension !== "md")) return [];
				return [file.path];
			}),
		),
	].sort((a, b) => a.localeCompare(b));
}

/** A selected path adds without rewriting any of the values already saved. */
export function appendPaths(current: readonly string[], additions: readonly string[]): string[] {
	const next = [...current];
	for (const path of additions) if (!next.includes(path)) next.push(path);
	return next;
}

/** A single file/folder field saves picked values through the same path as typed ones. */
export function suggestPath(input: TextComponent, row: SettingRowOf<"setting">, tab: SettingsControlActions): void {
	if (row.key !== "inbox" && row.key !== "dailyNoteFolder") return;
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	if (row.texts.placeholder === undefined) input.setPlaceholder(copy.settings.tab.pathPlaceholder);
	const suggest = new PathSuggest(
		tab.plugin.app,
		input.inputEl,
		() => vaultPaths(tab.plugin.app, row.key === "dailyNoteFolder" ? "folder" : "file"),
		(value) => {
			input.setValue(value);
			tab.save({ [row.key]: codec.parse(value) }, false).catch(reportSaveError);
		},
	);
	tab.registerCleanup?.(() => suggest.close());
}

/** Multi-path fields use removable chips and an explicit add step, keeping partial input out of the filters. */
export function renderPathList(setting: Setting, row: SettingRowOf<"setting">, tab: SettingsControlActions): void {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	const shell = setting.controlEl.createDiv({ cls: "tcw-setting-path-list" });
	const chips = shell.createDiv({ cls: "tcw-setting-chips" });
	const editor = shell.createDiv({ cls: "tcw-setting-path-editor" });
	let pending = false;
	let disposed = false;
	let field: TextComponent;
	let suggest: PathSuggest;
	let removeButtons: HTMLButtonElement[] = [];
	const setPending = (value: boolean) => {
		pending = value;
		addButton.disabled = value;
		for (const button of removeButtons) button.disabled = value;
	};
	const values = () => tab.options()[row.key] as string[];
	const drawChips = () => {
		chips.empty();
		removeButtons = [];
		for (const path of values()) {
			const chip = chips.createDiv({ cls: "tcw-setting-chip" });
			chip.createEl("span", { text: path || copy.settings.tab.emptyPathLabel });
			const remove = chip.createEl("button", {
				text: copy.settings.tab.removeGlyph,
				attr: {
					type: "button",
					"aria-label": copy.settings.tab.removePath({ path: path || copy.settings.tab.emptyPathLabel }),
				},
			});
			remove.disabled = pending;
			removeButtons.push(remove);
			remove.addEventListener("click", () => {
				if (pending || disposed) return;
				setPending(true);
				suggest.close();
				void tab
					.save({ [row.key]: values().filter((value) => value !== path) }, false)
					.catch(reportSaveError)
					.finally(() => {
						pending = false;
						if (disposed) return;
						setPending(false);
						drawChips();
						field.inputEl.focus();
					});
			});
		}
	};
	const commit = async (text = field.inputEl.value) => {
		if (pending || disposed || !text.trim()) return;
		const additions = codec.parse(text.replace(/\r?\n/g, ",")) as string[];
		setPending(true);
		suggest.close();
		try {
			await tab.save({ [row.key]: appendPaths(values(), additions) }, false);
			if (!disposed && field.inputEl.value === text) field.setValue("");
		} catch (error) {
			reportSaveError(error);
		} finally {
			pending = false;
			if (!disposed) {
				setPending(false);
				drawChips();
				field.inputEl.focus();
			}
		}
	};
	// Use Obsidian's component so its native input and suggestion keyboard handling remain consistent.
	setting.addText((input) => {
		field = input;
		input.setPlaceholder(copy.settings.tab.pathPlaceholder);
		input.inputEl.setAttribute("aria-label", row.texts.name);
		editor.appendChild(input.inputEl);
		suggest = new PathSuggest(
			tab.plugin.app,
			input.inputEl,
			() =>
				vaultPaths(tab.plugin.app, row.key === "taskFiles" ? "file" : "path").filter(
					(path) => path !== "" && !values().includes(path),
				),
			(value) => void commit(value),
		);
		input.inputEl.addEventListener("keydown", (evt) => {
			if (evt.defaultPrevented || evt.isComposing || evt.keyCode === 229 || evt.key !== "Enter") return;
			evt.preventDefault();
			void commit();
		});
		input.inputEl.addEventListener("paste", (evt) => {
			const text = evt.clipboardData?.getData("text/plain");
			if (!text || !/[,\r\n]/.test(text)) return;
			evt.preventDefault();
			const from = input.inputEl.selectionStart ?? input.inputEl.value.length;
			const to = input.inputEl.selectionEnd ?? from;
			const next =
				input.inputEl.value.slice(0, from) + text.replace(/[\r\n]+/g, ",") + input.inputEl.value.slice(to);
			input.setValue(next);
			void commit(next);
		});
	});
	const addButton = editor.createEl("button", { text: copy.settings.tab.addPathLabel, attr: { type: "button" } });
	addButton.addEventListener("click", () => void commit());
	shell.createDiv({ cls: "setting-item-description", text: copy.settings.tab.pathInputHint });
	tab.registerCleanup?.(() => {
		disposed = true;
		suggest.close();
	});
	drawChips();
}
