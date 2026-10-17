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
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
	{
		files: ["apps/**/*.{ts,tsx}"],
		// The tests run without Obsidian and use the npm moment, which the obsidian stub hands out too.
		ignores: ["apps/obsidian-plugin/utils/moment.ts", "apps/obsidian-plugin/tests/**"],
		rules: {
			"no-restricted-imports": ["error", {
				paths: [
					{ name: "obsidian", importNames: ["moment"], message: "Import moment from utils/moment, which types it as callable." },
					{
						name: "moment",
						allowTypeImports: true,
						message: "Import moment from utils/moment. The npm package would bundle a second moment, set to English instead of the user's Obsidian language.",
					},
				],
				patterns: [{
					group: ["moment/*"],
					allowTypeImports: true,
					message: "Obsidian's moment already has its locales; importing one from the npm package bundles a second moment.",
				}],
			}],
		},
	},
	{
		// The shared packages run outside Obsidian, see the restructuring plan.
		files: ["packages/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", {
				paths: [
					{ name: "obsidian", message: "Shared packages must not depend on Obsidian; pass what they need in from apps/obsidian-plugin." },
					{ name: "moment", allowTypeImports: true, message: "Shared packages get Obsidian's moment passed in; importing the npm package bundles a second moment in English." },
				],
				patterns: [
					{ group: ["moment/*"], allowTypeImports: true, message: "Shared packages get Obsidian's moment passed in; importing the npm package bundles a second moment in English." },
					{ group: ["**/apps/**", "**/obsidian-plugin/**"], message: "Shared packages must not reach into the plugin; the dependency only goes the other way." },
				],
			}],
		},
	},
	{
		// core is the bottom layer: no UI, no other workspace package.
		files: ["packages/core/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", {
				paths: [
					{ name: "obsidian", message: "core must not depend on Obsidian; pass what it needs in from apps/obsidian-plugin." },
					{ name: "moment", allowTypeImports: true, message: "core gets Obsidian's moment passed in; importing the npm package bundles a second moment in English." },
					{ name: "react", message: "core has no UI; components belong in packages/ui." },
					{ name: "react-dom", message: "core has no UI; components belong in packages/ui." },
				],
				patterns: [
					{ group: ["moment/*"], allowTypeImports: true, message: "core gets Obsidian's moment passed in; importing the npm package bundles a second moment in English." },
					{ group: ["**/apps/**", "**/obsidian-plugin/**", "@tasks-calendar-wrapper/*", "**/packages/ui/**"], message: "core is the bottom layer and imports no other workspace package." },
				],
			}],
		},
	},
);
