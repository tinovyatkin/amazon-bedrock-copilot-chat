// @ts-check
import { defineConfig } from "eslint/config";
import globals from "globals";

import js from "@eslint/js";
import markdown from "@eslint/markdown";
import stylistic from "@stylistic/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

export default defineConfig([
	{
		extends: ["js/recommended"],
		files: ["**/*.ts"],
		languageOptions: { globals: { ...globals.node } },
		plugins: { js },
	},
	tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		...perfectionist.configs["recommended-natural"],
		files: ["**/*.ts"],
	},
	{
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "all",
					argsIgnorePattern: "^_",
					caughtErrors: "all",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					ignoreRestSiblings: true,
					varsIgnorePattern: "^_",
				},
			],
			"perfectionist/sort-imports": "off",
		},
	},
	{
		files: ["**/*.mjs", "**/*.md"],
		extends: [tseslint.configs.disableTypeChecked],
		rules: {
			'@typescript-eslint/ban-ts-comment"': "off",
		},
	},
	{
		extends: ["markdown/recommended"],
		files: ["**/*.md"],
		language: "markdown/gfm",
		plugins: { markdown },
	},
	stylistic.configs.recommended,
	prettierConfig,
	{
		ignores: ["out", "node_modules", ".vscode-test", "vscode.d.ts"],
	},
]);
