/** Whether the value and every array and plain object in it are frozen. */
export function deeplyFrozen(value: unknown): boolean {
	if (value === null || typeof value !== "object") return true;
	return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

/** Whether no array or plain object in the value is frozen. */
export function nothingFrozen(value: unknown): boolean {
	if (value === null || typeof value !== "object") return true;
	return !Object.isFrozen(value) && Object.values(value).every(nothingFrozen);
}
