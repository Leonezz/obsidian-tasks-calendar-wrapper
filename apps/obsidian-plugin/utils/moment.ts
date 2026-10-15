import type momentFn from "moment";
import { moment as obsidianMoment } from "obsidian";

/**
 * The moment instance Obsidian ships. obsidian.d.ts types it as `import * as Moment from "moment"`,
 * which TypeScript 6 (always esModuleInterop) does not treat as callable, so this module gives it
 * the type of moment's callable export. Import moment from here, never from "obsidian".
 */
export const moment = obsidianMoment as unknown as typeof momentFn;
