// @ts-check
import { defineConfig } from "eslint/config";
import globals from "globals";

import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import js from "@eslint/js";
import markdown from "@eslint/markdown";
import stylistic from "@stylistic/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import perfectionist from "eslint-plugin-perfectionist";
import sonarjs from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    linterOptions: {
      reportUnusedInlineConfigs: "error",
    },
  },
  {
    extends: [
      "js/recommended",
      eslintPluginUnicorn.configs.recommended,
      sonarjs.configs.recommended,
    ],
    files: ["**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    plugins: { js },
    rules: {
      "unicorn/prevent-abbreviations": "off",
      "unicorn/import-style": "off",
      "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
      "unicorn/no-null": "off",
      "sonarjs/fixme-tag": "warn",
      "sonarjs/cognitive-complexity": ["error", 20],
      "sonarjs/no-alphabetical-sort": "off",
      "object-shorthand": "warn",
    },
  },
  tseslint.configs.stylisticTypeChecked,
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
  comments.recommended,
  {
    rules: {
      "no-unused-vars": "off",
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
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "no-fallthrough": ["error", { allowEmptyCase: true }],
      "perfectionist/sort-imports": "off",
      "@eslint-community/eslint-comments/require-description": "warn",
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
      ],
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowAny: true,
          allowNullableString: true,
          allowNullableBoolean: true,
          allowNullableObject: true,
          allowNullableNumber: false,
        },
      ],
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignorePrimitives: { string: true } },
      ],
      "@typescript-eslint/no-unnecessary-type-assertion": [
        "error",
        { checkLiteralConstAssertions: true },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console']",
          message:
            "Use logger instead of console for logging. Import logger from './logger' or '../logger', or pass logger as a function argument.",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: true,
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "no-duplicate-imports": "off",
      "@typescript-eslint/no-shadow": "error",
      "@typescript-eslint/no-unnecessary-type-conversion": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["**/*.mjs", "**/*.md"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    extends: ["markdown/recommended"],
    files: ["**/*.md"],
    language: "markdown/gfm",
    plugins: { markdown },
    rules: {
      "markdown/no-missing-label-refs": "off",
    },
  },
  stylistic.configs.recommended,
  prettierConfig,
  {
    files: ["**/src/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-empty-function": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    ignores: ["out", "dist", "node_modules", ".vscode-test", "**/vscode.d.ts"],
  },
]);
