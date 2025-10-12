import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		plugins: {
			'@stylistic': stylistic,
		},
		rules: {
			'@stylistic/semi': 'warn',
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		ignores: ['out', 'node_modules', '.vscode-test', 'vscode.d.ts'],
	}
);
