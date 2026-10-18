/** The code style of .editorconfig, plus the line width. `pnpm format` applies it, `pnpm format:check` checks it. */
export default {
	useTabs: true,
	tabWidth: 4,
	endOfLine: "lf",
	singleQuote: false,
	printWidth: 120,
	overrides: [
		{
			// YAML does not allow tabs.
			files: ["*.yml", "*.yaml"],
			options: { useTabs: false, tabWidth: 2 },
		},
	],
};
