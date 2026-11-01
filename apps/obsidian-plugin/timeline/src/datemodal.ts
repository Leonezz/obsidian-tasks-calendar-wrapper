import { App, ButtonComponent, Modal } from "obsidian";
import {
	dayKey,
	isRealDay,
	type DateField,
	type DateValue,
	type DayKey,
	type MomentFactory,
} from "@tasks-calendar-wrapper/core";
import { moment } from "../../utils/moment";
import { ownDate } from "./rowmenu";

/** A saved calendar day, an explicit removal, or closing without changing the task. */
export type DateAnswer = { readonly kind: "day"; readonly day: DayKey } | { readonly kind: "clear" } | null;

/** Picks a line's own date; every way of closing settles the answer through Obsidian's close callback. */
export class DateModal extends Modal {
	private selected: DateAnswer = null;
	private input?: HTMLInputElement;
	private readonly answer: Promise<DateAnswer>;

	constructor(
		app: App,
		private readonly field: DateField,
		private readonly sourceLine: string,
		private readonly dateMoment: MomentFactory & (() => DateValue) = moment,
	) {
		super(app);
		this.answer = new Promise((resolve) => this.setCloseCallback(() => resolve(this.selected)));
	}

	/** Opens the modal and focuses its date input. Resolves only when the modal closes. */
	ask(): Promise<DateAnswer> {
		this.open();
		this.input?.focus();
		return this.answer;
	}

	onOpen(): void {
		this.setTitle(`Pick ${this.field} date`);
		const own = ownDate(this.sourceLine, this.field, this.dateMoment);
		const input = this.contentEl.createEl("input", { attr: { type: "date" } });
		this.input = input;
		input.value = dayKey(own ?? this.dateMoment());
		const valid = () => /^\d{4}-\d{2}-\d{2}$/.test(input.value) && isRealDay(input.value);
		const save = () => {
			if (!valid()) return;
			this.selected = Object.freeze({ kind: "day", day: input.value });
			this.close();
		};
		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		if (own) {
			new ButtonComponent(buttons).setButtonText("Clear").onClick(() => {
				this.selected = Object.freeze({ kind: "clear" });
				this.close();
			});
		}
		const saveButton = new ButtonComponent(buttons)
			.setButtonText("Save")
			.setCta()
			.setDisabled(!valid())
			.onClick(save);
		input.addEventListener("input", () => saveButton.setDisabled(!valid()));
		input.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter") return;
			evt.preventDefault();
			save();
		});
	}
}
