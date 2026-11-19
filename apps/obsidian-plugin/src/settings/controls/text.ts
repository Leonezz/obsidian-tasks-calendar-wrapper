import type { RenderControl } from "./index";
import { ButtonComponent } from "obsidian";
import { copy } from "@tasks-calendar-wrapper/core";
import { reportSaveError } from "../save";
import { suggestPath } from "./pathPicker";

/** Draws a text box using the row's codec. */
export const renderText: RenderControl = (setting, row, tab) => {
	const codec = row.spec.codec;
	if (!codec) throw new Error(`Missing setting codec: ${row.key}`);
	const statusField = row.key === "hideStatusTasks";
	const formatStatuses = (markers: readonly string[]) =>
		markers.map((marker) => (marker === " " ? "[ ]" : marker)).join(",");
	let refreshPresets: (markers: readonly string[]) => void = () => {};
	setting.addText((t) => {
		if (row.texts.placeholder !== undefined) t.setPlaceholder(row.texts.placeholder);
		t.setValue(statusField ? formatStatuses(tab.options().hideStatusTasks) : codec.format(tab.options()[row.key]));
		t.inputEl.setAttribute("aria-label", row.texts.name);
		t.onChange((v) => {
			const value = codec.parse(v);
			if (statusField) refreshPresets(value as string[]);
			return tab.save({ [row.key]: value }, row.redrawsTab).catch(reportSaveError);
		});
		if (statusField) {
			setting.controlEl.addClass("tcw-settings-status-control");
			const group = setting.controlEl.createDiv({
				cls: "tcw-settings-status-presets",
				attr: { role: "group", "aria-label": row.texts.name },
			});
			const presets = [
				[copy.settings.tab.statusPresets.todo, " "],
				[copy.settings.tab.statusPresets.done, "x"],
				[copy.settings.tab.statusPresets.cancelled, "-"],
			] as const;
			let pending = false;
			let disposed = false;
			const buttons: { marker: string; button: ButtonComponent }[] = [];
			refreshPresets = (markers) => {
				for (const { marker, button } of buttons)
					button.buttonEl.setAttribute("aria-pressed", String(markers.includes(marker)));
			};
			for (const [id, marker] of presets) {
				const button = new ButtonComponent(group).setButtonText(id).onClick(async () => {
					if (pending || disposed) return;
					const current = tab.options().hideStatusTasks;
					// Include custom text typed before an earlier queued save has reached the store.
					const markers =
						t.inputEl.value === formatStatuses(current)
							? current
							: (codec.parse(t.inputEl.value) as string[]);
					const next = markers.includes(marker)
						? markers.filter((value) => value !== marker)
						: [...markers, marker];
					pending = true;
					for (const { button } of buttons) button.setDisabled(true);
					t.setValue(formatStatuses(next));
					refreshPresets(next);
					try {
						await tab.save({ hideStatusTasks: next }, false);
					} catch (error) {
						reportSaveError(error);
					} finally {
						pending = false;
						if (!disposed) for (const { button } of buttons) button.setDisabled(false);
					}
				});
				buttons.push({ marker, button });
			}
			refreshPresets(tab.options().hideStatusTasks);
			tab.registerCleanup?.(() => {
				disposed = true;
			});
		}
		suggestPath(t, row, tab);
	});
};
