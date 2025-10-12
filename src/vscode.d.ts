declare module "vscode" {
	export interface LanguageModelChatProvider {
		prepareLanguageModelChatInformation?(
			options: { silent: boolean },
			token: CancellationToken
		): ProviderResult<LanguageModelChatInformation[]>;
	}
}

export {};
