import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const clockMessage = "core gets the current time passed in as `now`; it never reads the clock.";

/** core gets the time passed in, and has to load on the older engines Obsidian runs on. */
const coreSyntaxRules = [
	{
		selector:
			"MemberExpression[object.name='Date'][property.name='now'], MemberExpression[object.name='Date'][property.value='now']",
		message: clockMessage,
	},
	{
		selector:
			"NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.name='Date'], MemberExpression[object.name='globalThis'][property.name='Date']",
		message: clockMessage,
	},
	{
		selector: "Literal[regex.pattern=/\\(\\?<[=!]/]",
		message: "Regex lookbehind is missing before Safari 16.4, so older iOS devices could not load the plugin.",
	},
	{
		selector: "Literal[regex.flags=/v/]",
		message:
			"The v flag is missing before Safari 17 and stopped the plugin from loading (#184); build the RegExp with a fallback, as createEmojiMatcher does.",
	},
];

const onlyDatesNamesMoment =
	"Only core/dates.ts uses moment's types. Elsewhere core sees dates as DateValue, which cannot be changed: compare with the helpers in dates.ts, or call clone() for a moment of your own.";

/** Outside core/dates.ts, core never names Moment, so it cannot cast a DateValue back to something it could change. */
const momentTypeRule = {
	selector:
		"TSTypeReference[typeName.name='Moment'], TSQualifiedName[right.name='Moment'], TSImportType[qualifier.name='Moment']",
	message: onlyDatesNamesMoment,
};

/** What core may not import. The plugin passes Obsidian's moment in; dates.ts imports only moment's types. */
const coreImportRules = {
	paths: [
		{
			name: "obsidian",
			message: "core must not depend on Obsidian; pass what it needs in from apps/obsidian-plugin.",
		},
		{
			name: "moment",
			allowTypeImports: true,
			message:
				"core gets Obsidian's moment passed in; importing the npm package bundles a second moment in English.",
		},
		{ name: "react", message: "core has no UI; components belong in packages/ui." },
		{ name: "react-dom", message: "core has no UI; components belong in packages/ui." },
	],
	patterns: [
		{
			group: ["moment/*"],
			allowTypeImports: true,
			message:
				"core gets Obsidian's moment passed in; importing the npm package bundles a second moment in English.",
		},
		{
			group: ["**/apps/**", "**/obsidian-plugin/**", "@tasks-calendar-wrapper/*", "**/packages/ui/**"],
			message: "core is the bottom layer and imports no other workspace package.",
		},
	],
};

/** The same, but outside dates.ts not even moment's types may be imported, which would let a module alias Moment. */
const coreImportRulesOutsideDates = {
	paths: coreImportRules.paths.map((rule) =>
		rule.name === "moment" ? { name: "moment", message: onlyDatesNamesMoment } : rule,
	),
	patterns: coreImportRules.patterns.map((rule) =>
		rule.group.includes("moment/*") ? { group: ["moment/*"], message: onlyDatesNamesMoment } : rule,
	),
};

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
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ args: "none", varsIgnorePattern: "^default|Props$|States$" },
			],
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
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							importNames: ["moment"],
							message: "Import moment from utils/moment, which types it as callable.",
						},
						{
							name: "moment",
							allowTypeImports: true,
							message:
								"Import moment from utils/moment. The npm package would bundle a second moment, set to English instead of the user's Obsidian language.",
						},
					],
					patterns: [
						{
							group: ["moment/*"],
							allowTypeImports: true,
							message:
								"Obsidian's moment already has its locales; importing one from the npm package bundles a second moment.",
						},
					],
				},
			],
		},
	},
	{
		// The shared packages run outside Obsidian, see the restructuring plan.
		files: ["packages/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							message:
								"Shared packages must not depend on Obsidian; pass what they need in from apps/obsidian-plugin.",
						},
						{
							name: "moment",
							allowTypeImports: true,
							message:
								"Shared packages get Obsidian's moment passed in; importing the npm package bundles a second moment in English.",
						},
					],
					patterns: [
						{
							group: ["moment/*"],
							allowTypeImports: true,
							message:
								"Shared packages get Obsidian's moment passed in; importing the npm package bundles a second moment in English.",
						},
						{
							group: ["**/apps/**", "**/obsidian-plugin/**"],
							message:
								"Shared packages must not reach into the plugin; the dependency only goes the other way.",
						},
					],
				},
			],
		},
	},
	{
		// core is the bottom layer: no UI, no other workspace package.
		files: ["packages/core/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": ["error", coreImportRules],
		},
	},
	{
		// core's tests run in Node, where the npm moment stands in for Obsidian's.
		files: ["packages/core/tests/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "obsidian", message: "core's tests run without Obsidian, like core itself." },
						{ name: "react", message: "core has no UI; components belong in packages/ui." },
						{ name: "react-dom", message: "core has no UI; components belong in packages/ui." },
					],
					patterns: [
						{
							group: [
								"**/apps/**",
								"**/obsidian-plugin/**",
								"@tasks-calendar-wrapper/*",
								"**/packages/ui/**",
							],
							message: "core's tests test core alone.",
						},
					],
				},
			],
		},
	},
	{
		files: ["packages/core/src/**/*.{ts,tsx}"],
		ignores: ["packages/core/src/dates.ts"],
		rules: {
			"no-restricted-imports": ["error", coreImportRulesOutsideDates],
			"no-restricted-syntax": ["error", ...coreSyntaxRules, momentTypeRule],
		},
	},
	{
		files: ["packages/core/src/dates.ts"],
		rules: {
			"no-restricted-syntax": ["error", ...coreSyntaxRules],
		},
	},
);
