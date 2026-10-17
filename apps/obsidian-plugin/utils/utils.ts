import { relativeDate as relativeDateIn, type DateValue } from "@tasks-calendar-wrapper/core";
import { moment } from "./moment";

// isTagHidden moved to packages/core; re-exported for the modules that import it from here.
export { isTagHidden } from "@tasks-calendar-wrapper/core";

/**
 * Describes a date relative to today, e.g. "Tomorrow" or "in 2 days", in the language
 * the app is set to.
 */
export function relativeDate(date: DateValue, now: DateValue = moment()): string {
    return relativeDateIn(date, now, moment.locale(), (message, error) => console.warn(message, error));
}

type EditorCheckCallback = (checking: boolean, editor: unknown, view: unknown) => boolean | void;
type EditorCommand = { editorCheckCallback?: EditorCheckCallback };

/**
 * Looks up an editor command of the Tasks plugin. When the plugin is disabled or missing the
 * command is absent, which used to end in an uncaught TypeError with nothing shown to the user.
 */
export function tasksPluginCommand(
    commands: Record<string, EditorCommand>,
    commandId: string,
): Required<EditorCommand> {
    const command = commands[commandId];
    if (!command?.editorCheckCallback) throw new Error(`the Tasks plugin is not enabled, so ${commandId} is not available`);
    // The command object itself is returned, so the callback is still called as its method.
    return command as Required<EditorCommand>;
}

/** The documented URI that opens the search pane of the vault on a tag, e.g. #work. */
export function tagSearchUri(vaultName: string, tag: string): string {
    return `obsidian://search?vault=${encodeURIComponent(vaultName)}&query=${encodeURIComponent("tag:" + tag)}`;
}
