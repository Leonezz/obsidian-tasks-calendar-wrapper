/**
 * Minimal runtime stand-in for the `obsidian` package, which ships type
 * declarations only. Tests alias `obsidian` to this module.
 */
import moment from "moment";

export { moment };

/** Obsidian shows a toast; the tests only need it to exist. */
export class Notice {
    constructor(public message: string, public duration?: number) { }
}
