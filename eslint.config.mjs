import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/node_modules/", "**/main.js", "ExampleVault/"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		rules: {
			"no-unused-vars": "off",
			// The class components declare `defaultXxxProps`-style values only to derive their prop types from.
			"@typescript-eslint/no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^default|Props$|States$" }],
			"@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
	{
		files: ["apps/**/*.{ts,tsx}"],
		ignores: ["apps/obsidian-plugin/utils/moment.ts"],
		rules: {
			"no-restricted-imports": ["error", {
				paths: [{ name: "obsidian", importNames: ["moment"], message: "Import moment from utils/moment, which types it as callable." }],
			}],
		},
	},
	{
		// The shared packages run outside Obsidian, see the restructuring plan.
		files: ["packages/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", {
				paths: [{ name: "obsidian", message: "Shared packages must not depend on Obsidian; pass what they need in from apps/obsidian-plugin." }],
			}],
		},
	},
);
