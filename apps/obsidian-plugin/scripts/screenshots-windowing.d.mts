/** The page remains fixed at this size for both benchmark scales and both arms. */
export const WINDOWING_VIEWPORT: Readonly<{ width: 1280; height: 800; deviceScaleFactor: 1; mobile: false }>;
export const WINDOWING_POSITIONS: readonly ["top", "today", "bottom"];

export interface ViewportRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A rendered instance is a day plus note path and line; one task can have more than one day. */
export interface ViewportRow {
	day: string;
	path: string;
	line: number;
	text: string;
	status: string | null;
	/** The positive intersection after viewport, ancestor overflow and window clipping. */
	rect: ViewportRect;
}

export interface ViewportMeasurement {
	viewport: ViewportRect;
	scrollTop: number;
	scrollHeight: number;
	mountedRows: number;
	windowed: boolean;
	rows: readonly ViewportRow[];
}

export interface ViewportSample extends ViewportMeasurement {
	/** From the committed full arrangement, independently of DOM mount count. */
	rowCount: number;
	logicalWindowed: boolean;
}

export interface ViewportProblem {
	kind: "opening" | "mode" | "empty" | "mounted" | "viewport" | "duplicate" | "row";
	detail?: string;
	index?: number;
	base?: readonly (string | number | null)[] | null;
	windowed?: readonly (string | number | null)[] | null;
}

/** Checks the untouched opening position before top/today/bottom alignment. */
export function compareOpeningScroll(arm: "off" | "default", opening: { scrollTop: number }): ViewportProblem[];
/** Self-contained browser function, also exercised against deterministic DOM geometry in tests. */
export function collectViewportRows(input: { container: string }): ViewportMeasurement;
export function compareViewportRows(base: ViewportSample, windowed: ViewportSample): ViewportProblem[];
export function windowingPage(input: {
	action: "open" | "position" | "cleanup";
	pluginId?: string;
	viewType?: string;
	arm?: "off" | "default";
	position?: "top" | "today" | "bottom";
	todayKey?: string;
}): Promise<unknown>;
