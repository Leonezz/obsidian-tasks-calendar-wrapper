export function integer(random: () => number, limit: number): number {
	return Math.floor(random() * limit);
}

export function noteFor(random: () => number, index: number): string {
	const phrases = ["plain", "中文", "🗓️ tomorrow", "- [ ] identical", "", "\ufeffinside"];
	const rows = Array.from({ length: 1 + integer(random, 8) }, () => phrases[integer(random, phrases.length)]);
	const target = integer(random, rows.length);
	rows[target] = `- [ ] task ${integer(random, 5)}`;
	switch (index % 7) {
		case 0:
			rows.unshift("---", "title: tasks", "---");
			break;
		case 1:
			rows[target] = "> - [ ] callout";
			rows.splice(target, 0, "> [!todo]");
			break;
		case 2:
			rows.splice(target + 1, 0, "  continuation", "    nested continuation");
			break;
		case 3:
			rows.splice(target, 0, rows[target], rows[target]);
			break;
		case 4:
			rows.splice(0, rows.length, "- [ ] only task");
			break;
		case 5:
			rows.splice(0, rows.length, "");
			break;
	}
	const mode = integer(random, 3);
	const ending = () => (mode === 0 ? "\n" : mode === 1 ? "\r\n" : random() < 0.5 ? "\n" : "\r\n");
	const trailing = random() < 0.5;
	const content = rows.map((row, i) => row + (i < rows.length - 1 || trailing ? ending() : "")).join("");
	return (random() < 0.35 ? "\ufeff" : "") + content;
}

export function pick<T>(random: () => number, values: readonly T[]): T {
	return values[integer(random, values.length)];
}
