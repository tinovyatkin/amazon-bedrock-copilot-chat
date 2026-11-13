# Amazon Bedrock model catalogue

> Generated from `src/models-dev-cache.json`. The cache is the `models.dev` Amazon Bedrock registry snapshot, not an AWS price quote.
> Prices below retain the registry's USD-per-1M-token values; no currency conversion is applied.
> AWS bills according to the selected model, inference mode, region, applicable price tiers, caching, and other features. Confirm live prices before deployment.
> Target region: **Europe (Ireland), `eu-west-1`**. An `eu.` inference-profile row is used where available; this profile can route across its supported EU regions and is not a guarantee that inference runs only in Ireland. Otherwise the registry's base model rate is shown. Use regional inference profiles if residency policy requires them.

## Sources and interpretation

- [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — authoritative live pricing.
- [AWS models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) — model providers and model cards.
- [AWS data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) and [data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html).
- [AWS abuse detection and model-specific terms](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html).
- [models.dev registry](https://models.dev/) supplies the bundled model descriptions, modalities, limits, and USD price estimates; these descriptions are concise intended-use summaries, not independent AWS endorsements.
- Modalities, token limits, tool support, and prices reflect the bundled registry snapshot. Missing details mean the cache does not specify them.

This catalogue contains **56 base model IDs**. Region-prefixed and global inference-profile IDs are omitted; use the `eu.` profile when EU-region inference routing is required.

## Amazon

### Nova 2 Lite

- **Bedrock model ID:** `amazon.nova-2-lite-v1:0`
- **Built by:** Amazon (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.html)).
- **Intended/documented use:** Multimodal reasoning model for visual analysis, planning, and tool use
- **Input / output:** text, image, video, pdf / text.
- **Context / maximum output:** 1,000,000 / 65,535 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.33 / output $2.75 per 1M tokens
- Cache read: $0.0825 per 1M tokens
- Cache write: $0.33 per 1M tokens

### Nova Lite

- **Bedrock model ID:** `amazon.nova-lite-v1:0`
- **Built by:** Amazon (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.html)).
- **Intended/documented use:** Efficient model for low-latency assistance, extraction, and routine automation
- **Input / output:** text, image, video, pdf / text.
- **Context / maximum output:** 300,000 / 10,000 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.06 / output $0.24 per 1M tokens
- Cache read: $0.015 per 1M tokens
- Cache write: $0.06 per 1M tokens

### Nova Micro

- **Bedrock model ID:** `amazon.nova-micro-v1:0`
- **Built by:** Amazon (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.html)).
- **Intended/documented use:** Efficient model for low-latency assistance, extraction, and routine automation
- **Input / output:** text / text.
- **Context / maximum output:** 128,000 / 10,000 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.035 / output $0.14 per 1M tokens
- Cache read: $0.0088 per 1M tokens
- Cache write: $0.035 per 1M tokens

### Nova Pro

- **Bedrock model ID:** `amazon.nova-pro-v1:0`
- **Built by:** Amazon (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.html)).
- **Intended/documented use:** Flagship model for demanding analysis, coding, and production agent workflows
- **Input / output:** text, image, video, pdf / text.
- **Context / maximum output:** 300,000 / 10,000 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.8 / output $3.2 per 1M tokens
- Cache read: $0.2 per 1M tokens
- Cache write: $0.8 per 1M tokens

## Anthropic

### Claude Fable 5

- **Bedrock model ID:** `anthropic.claude-fable-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Claude model for creative writing, analysis, and controlled agent workflows
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** **AWS review required.** AWS documents up to 30-day retention of all prompts and completions within AWS; classifier-flagged traffic may receive human review by AWS. The provider does not receive the content. Account data-retention mode must permit `aws_review` (legacy `provider_data_share` also satisfies this). Eligible Enterprise Frontier Safeguards customers may have a model-specific ZDR exception.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $10 / output $50 per 1M tokens
- Cache read: $1 per 1M tokens
- Cache write: $12.5 per 1M tokens

### Claude Fable 5.1

- **Bedrock model ID:** `anthropic.claude-fable-5-1`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Claude model for demanding reasoning and long-horizon agentic work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** **AWS review required.** AWS documents up to 30-day retention of all prompts and completions within AWS; classifier-flagged traffic may receive human review by AWS. The provider does not receive the content. Account data-retention mode must permit `aws_review` (legacy `provider_data_share` also satisfies this). Eligible Enterprise Frontier Safeguards customers may have a model-specific ZDR exception.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $10 / output $50 per 1M tokens
- Cache read: $0.25 per 1M tokens
- Cache write: $12.5 per 1M tokens

### Claude Fable 5.2

- **Bedrock model ID:** `anthropic.claude-fable-5-2`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Claude model for demanding reasoning and long-horizon agentic work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** **AWS review required.** AWS documents up to 30-day retention of all prompts and completions within AWS; classifier-flagged traffic may receive human review by AWS. The provider does not receive the content. Account data-retention mode must permit `aws_review` (legacy `provider_data_share` also satisfies this). Eligible Enterprise Frontier Safeguards customers may have a model-specific ZDR exception.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $8 / output $40 per 1M tokens
- Cache read: $0.2 per 1M tokens
- Cache write: $10 per 1M tokens

### Claude Haiku 4.5

- **Bedrock model ID:** `anthropic.claude-haiku-4-5-20251001-v1:0`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Fast Claude model for responsive assistance, classification, and lightweight agents
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 200,000 / 64,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $1 / output $5 per 1M tokens
- Cache read: $0.1 per 1M tokens
- Cache write: $1.25 per 1M tokens

### Claude Haiku 5.5

- **Bedrock model ID:** `anthropic.claude-haiku-5-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Fast Claude model for responsive assistance, classification, and lightweight agents
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.1 / output $0.5 per 1M tokens
- Context tier above 100,000 tokens: input $0.5 / output $2.5 per 1M tokens
- Cache read: $0.01 per 1M tokens
- Cache write: $0.125 per 1M tokens

### Claude Opus 4.5

- **Bedrock model ID:** `anthropic.claude-opus-4-5-20251101-v1:0`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Flagship Claude model for deep reasoning, coding, and long-horizon agents
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 200,000 / 64,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5 / output $25 per 1M tokens
- Cache read: $0.5 per 1M tokens
- Cache write: $6.25 per 1M tokens

### Claude Opus 4.6

- **Bedrock model ID:** `anthropic.claude-opus-4-6-v1`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** High-end Claude for difficult coding, planning, and slower expert reasoning
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5.5 / output $27.5 per 1M tokens
- Cache read: $0.55 per 1M tokens
- Cache write: $6.875 per 1M tokens

### Claude Opus 4.7

- **Bedrock model ID:** `anthropic.claude-opus-4-7`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Stronger Opus tier for advanced software work and high-stakes reasoning
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5 / output $25 per 1M tokens
- Cache read: $0.5 per 1M tokens
- Cache write: $6.25 per 1M tokens

### Claude Opus 4.8

- **Bedrock model ID:** `anthropic.claude-opus-4-8`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Top Claude Opus tier for the hardest reasoning, coding, and long-horizon agents
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5 / output $25 per 1M tokens
- Cache read: $0.5 per 1M tokens
- Cache write: $6.25 per 1M tokens

### Claude Opus 5

- **Bedrock model ID:** `anthropic.claude-opus-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Strongest Claude Opus model for coding, agents, and professional work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5 / output $25 per 1M tokens
- Cache read: $0.5 per 1M tokens
- Cache write: $6.25 per 1M tokens

### Claude Opus 5.5

- **Bedrock model ID:** `anthropic.claude-opus-5-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Claude model for long-running agentic coding and knowledge work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $4 / output $20 per 1M tokens
- Cache read: $0.2 per 1M tokens
- Cache write: $5 per 1M tokens

### Claude Sonnet 4.6

- **Bedrock model ID:** `anthropic.claude-sonnet-4-6`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Claude workhorse for coding agents, careful analysis, and production cost control
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $3.3 / output $16.5 per 1M tokens
- Cache read: $0.33 per 1M tokens
- Cache write: $4.125 per 1M tokens

### Claude Sonnet 5

- **Bedrock model ID:** `anthropic.claude-sonnet-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Everyday Claude agent model for coding, planning, browsing, and general work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2 / output $10 per 1M tokens
- Cache read: $0.2 per 1M tokens
- Cache write: $2.5 per 1M tokens

### Claude Sonnet 5.5

- **Bedrock model ID:** `anthropic.claude-sonnet-5-5`
- **Built by:** Anthropic (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-anthropic.html)).
- **Intended/documented use:** Fast Claude model for everyday coding, agents, and knowledge work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No additional retention change is documented for Claude models released before Fable 5. AWS's general abuse-detection and account data-retention terms still apply; verify the exact model's current terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2 / output $10 per 1M tokens
- Cache read: $0.1 per 1M tokens
- Cache write: $2.5 per 1M tokens

## DeepSeek

### DeepSeek V3.2

- **Bedrock model ID:** `deepseek.v3.2`
- **Built by:** DeepSeek (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-deepseek.html)).
- **Intended/documented use:** Hybrid-reasoning DeepSeek model with thinking and non-thinking modes, sparse attention, and tool-use
- **Input / output:** text / text.
- **Context / maximum output:** 163,840 / 81,920 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.62 / output $1.85 per 1M tokens

## Google

### Gemma 4 26B A4B IT

- **Bedrock model ID:** `google.gemma-4-26b-a4b`
- **Built by:** Google (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)).
- **Intended/documented use:** Open Gemma instruction model for efficient chat and self-hosted deployments
- **Input / output:** text, image, video / text.
- **Context / maximum output:** 262,144 / 32,768 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.13 / output $0.4 per 1M tokens

### Gemma 4 31B IT

- **Bedrock model ID:** `google.gemma-4-31b`
- **Built by:** Google (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)).
- **Intended/documented use:** Largest Gemma 4 instruction model for open, self-hosted chat and reasoning
- **Input / output:** text, image, video / text.
- **Context / maximum output:** 262,144 / 32,768 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.14 / output $0.4 per 1M tokens

### Gemma 4 E2B IT

- **Bedrock model ID:** `google.gemma-4-e2b`
- **Built by:** Google (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)).
- **Intended/documented use:** Open Gemma instruction model for efficient chat and self-hosted deployments
- **Input / output:** text, image, audio, video / text.
- **Context / maximum output:** 131,072 / 8,192 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.04 / output $0.08 per 1M tokens

## MiniMax

### MiniMax-M2.5

- **Bedrock model ID:** `minimax.minimax-m2.5`
- **Built by:** MiniMax (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-minimax.html)).
- **Intended/documented use:** Prior MiniMax coding model for agent workflows, office edits, and automation
- **Input / output:** text / text.
- **Context / maximum output:** 196,608 / 98,304 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.3 / output $1.2 per 1M tokens

## Mistral AI

### Magistral Small 1.2

- **Bedrock model ID:** `mistral.magistral-small-2509`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Open multimodal reasoning model for transparent analysis of text and images
- **Input / output:** text, image / text.
- **Context / maximum output:** 128,000 / 40,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.5 / output $1.5 per 1M tokens

### Ministral 14B 3.0

- **Bedrock model ID:** `mistral.ministral-3-14b-instruct`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Open vision-language model for efficient local deployment, instruction following, and tool use
- **Input / output:** text, image / text.
- **Context / maximum output:** 128,000 / 4,096 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.2 / output $0.2 per 1M tokens

### Ministral 3 3B

- **Bedrock model ID:** `mistral.ministral-3-3b-instruct`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Compact open vision-language model for edge deployment, instruction following, and tool use
- **Input / output:** text, image / text.
- **Context / maximum output:** 256,000 / 8,192 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.1 / output $0.1 per 1M tokens

### Ministral 3 8B

- **Bedrock model ID:** `mistral.ministral-3-8b-instruct`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Compact open vision-language model for edge deployment, instruction following, and tool use
- **Input / output:** text, image / text.
- **Context / maximum output:** 128,000 / 4,096 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.15 per 1M tokens

### Mistral Large 3

- **Bedrock model ID:** `mistral.mistral-large-3-675b-instruct`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Mistral's largest general model for enterprise agents, coding, and multilingual reasoning
- **Input / output:** text, image / text.
- **Context / maximum output:** 262,144 / 8,192 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.5 / output $1.5 per 1M tokens

### Pixtral Large (25.02)

- **Bedrock model ID:** `mistral.pixtral-large-2502-v1:0`
- **Built by:** Mistral AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-mistral-ai.html)).
- **Intended/documented use:** Mistral vision-language model for image understanding and multimodal chat
- **Input / output:** text, image / text.
- **Context / maximum output:** 128,000 / 8,192 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2 / output $6 per 1M tokens

## Moonshot AI

### Kimi K2.5

- **Bedrock model ID:** `moonshotai.kimi-k2.5`
- **Built by:** Moonshot AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-moonshot-ai.html)).
- **Intended/documented use:** Earlier Kimi frontier model for long-context agents, coding, and multimodal work
- **Input / output:** text, image / text.
- **Context / maximum output:** 262,144 / 16,384 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.6 / output $3 per 1M tokens

## NVIDIA

### NVIDIA Nemotron 3 Super 120B A12B

- **Bedrock model ID:** `nvidia.nemotron-super-3-120b`
- **Built by:** NVIDIA (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-nvidia.html)).
- **Intended/documented use:** Nemotron middle tier for collaborative agents and high-volume reasoning workloads
- **Input / output:** text / text.
- **Context / maximum output:** 262,144 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.65 per 1M tokens

### NVIDIA Nemotron Nano 3 30B

- **Bedrock model ID:** `nvidia.nemotron-nano-3-30b`
- **Built by:** NVIDIA (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-nvidia.html)).
- **Intended/documented use:** Small Nemotron 3 MoE for efficient coding, math, and long-context agents
- **Input / output:** text / text.
- **Context / maximum output:** 262,144 / 8,192 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.06 / output $0.24 per 1M tokens

## OpenAI

### GPT OSS Safeguard 120B

- **Bedrock model ID:** `openai.gpt-oss-safeguard-120b`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Safety model for policy screening, moderation, and risk-aware routing workflows
- **Input / output:** text / text.
- **Context / maximum output:** 128,000 / 16,384 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.6 per 1M tokens

### GPT OSS Safeguard 20B

- **Bedrock model ID:** `openai.gpt-oss-safeguard-20b`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Safety model for policy screening, moderation, and risk-aware routing workflows
- **Input / output:** text / text.
- **Context / maximum output:** 128,000 / 16,384 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.07 / output $0.2 per 1M tokens

### GPT-5.4

- **Bedrock model ID:** `openai.gpt-5.4`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Agent-ready GPT for coding and computer-use workflows at a lower cost
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2.75 / output $16.5 per 1M tokens
- Cache read: $0.275 per 1M tokens

### GPT-5.5

- **Bedrock model ID:** `openai.gpt-5.5`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Default frontier GPT for coding, computer use, research, and knowledge work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,000,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $5.5 / output $33 per 1M tokens
- Cache read: $0.55 per 1M tokens

### GPT-5.6 Luna

- **Bedrock model ID:** `openai.gpt-5.6-luna`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Cost-efficient GPT-5.6 model for fast, high-volume workloads
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.22 / output $1.32 per 1M tokens
- Context above 200,000 tokens: input $0.44 / output $1.98 per 1M tokens
- Cache read: $0.022 per 1M tokens
- Cache write: $0.275 per 1M tokens

### GPT-5.6 Sol

- **Bedrock model ID:** `openai.gpt-5.6-sol`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Frontier GPT-5.6 model for complex professional work, coding, and agentic workflows
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $4.4 / output $22 per 1M tokens
- Context above 200,000 tokens: input $8.8 / output $33 per 1M tokens
- Cache read: $0.44 per 1M tokens
- Cache write: $5.5 per 1M tokens

### GPT-5.6 Terra

- **Bedrock model ID:** `openai.gpt-5.6-terra`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Balanced GPT-5.6 model for capable, cost-efficient everyday work
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2.2 / output $13.2 per 1M tokens
- Context above 200,000 tokens: input $4.4 / output $19.8 per 1M tokens
- Cache read: $0.22 per 1M tokens
- Cache write: $2.75 per 1M tokens

### GPT-6 Astra

- **Bedrock model ID:** `openai.gpt-6-astra`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** GPT-6 Astra is OpenAI's most capable model for complex reasoning, coding, computer use, research, and document creation.
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $11 / output $55 per 1M tokens
- Context above 200,000 tokens: input $22 / output $82.5 per 1M tokens
- Cache read: $1.1 per 1M tokens
- Cache write: $13.75 per 1M tokens

### GPT-6 Luna

- **Bedrock model ID:** `openai.gpt-6-luna`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** OpenAI's most efficient model for focused, high-volume tasks
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.11 / output $0.55 per 1M tokens
- Context above 200,000 tokens: input $0.22 / output $0.825 per 1M tokens
- Cache read: $0.011 per 1M tokens
- Cache write: $0.1375 per 1M tokens

### GPT-6 Sol

- **Bedrock model ID:** `openai.gpt-6-sol`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** OpenAI model for complex coding and agentic workflows
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2.2 / output $11 per 1M tokens
- Context above 200,000 tokens: input $4.4 / output $16.5 per 1M tokens
- Cache read: $0.22 per 1M tokens
- Cache write: $2.75 per 1M tokens

### GPT-6.1 Sol

- **Bedrock model ID:** `openai.gpt-6.1-sol`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Near-Astra performance for complex coding, computer use, and professional work at a lower cost.
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2.2 / output $11 per 1M tokens
- Context above 200,000 tokens: input $4.4 / output $16.5 per 1M tokens
- Cache read: $0.11 per 1M tokens
- Cache write: $2.75 per 1M tokens

### GPT-6.1 Terra

- **Bedrock model ID:** `openai.gpt-6.1-terra`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Fast, efficient model for visual reasoning, precise computer use, and clear, natural writing.
- **Input / output:** text, image, pdf / text.
- **Context / maximum output:** 1,050,000 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** AWS documents retention of classifier-flagged traffic for up to 30 days for automated offline abuse detection; eligible customers may request full ZDR. See AWS's model-specific abuse-detection terms.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $1.1 / output $5.5 per 1M tokens
- Context above 200,000 tokens: input $2.2 / output $8.25 per 1M tokens
- Cache read: $0.055 per 1M tokens
- Cache write: $1.375 per 1M tokens

### gpt-oss-120b

- **Bedrock model ID:** `openai.gpt-oss-120b`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Open GPT reasoning model for self-hosted agents and controllable deployments
- **Input / output:** text / text.
- **Context / maximum output:** 131,072 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.6 per 1M tokens

### gpt-oss-120b

- **Bedrock model ID:** `openai.gpt-oss-120b-1:0`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Open GPT reasoning model for self-hosted agents and controllable deployments
- **Input / output:** text / text.
- **Context / maximum output:** 131,072 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.6 per 1M tokens

### gpt-oss-20b

- **Bedrock model ID:** `openai.gpt-oss-20b`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Open GPT reasoning model for self-hosted agents and controllable deployments
- **Input / output:** text / text.
- **Context / maximum output:** 131,072 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.07 / output $0.3 per 1M tokens

### gpt-oss-20b

- **Bedrock model ID:** `openai.gpt-oss-20b-1:0`
- **Built by:** OpenAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-openai.html)).
- **Intended/documented use:** Open GPT reasoning model for self-hosted agents and controllable deployments
- **Input / output:** text / text.
- **Context / maximum output:** 131,072 / 128,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.07 / output $0.3 per 1M tokens

## Qwen

### Qwen3 235B-A22B Instruct 2507

- **Bedrock model ID:** `qwen.qwen3-235b-a22b-2507-v1:0`
- **Built by:** Qwen (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-qwen.html)).
- **Intended/documented use:** Updated large open Qwen3 MoE instruct model for multilingual chat, coding, and tool use
- **Input / output:** text / text.
- **Context / maximum output:** 262,144 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.22 / output $0.88 per 1M tokens

### Qwen3 32B

- **Bedrock model ID:** `qwen.qwen3-32b-v1:0`
- **Built by:** Qwen (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-qwen.html)).
- **Intended/documented use:** Dense open Qwen model for self-hosted chat, reasoning, and coding
- **Input / output:** text / text.
- **Context / maximum output:** 32,768 / 16,384 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $0.6 per 1M tokens

### Qwen3 Coder Next

- **Bedrock model ID:** `qwen.qwen3-coder-next`
- **Built by:** Qwen (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-qwen.html)).
- **Intended/documented use:** Open-weight Qwen coding model for agents, repository edits, and multi-turn tool use
- **Input / output:** text / text.
- **Context / maximum output:** 262,144 / 65,536 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.5 / output $1.2 per 1M tokens

### Qwen3 VL 235B A22B Instruct

- **Bedrock model ID:** `qwen.qwen3-vl-235b-a22b`
- **Built by:** Qwen (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-qwen.html)).
- **Intended/documented use:** Qwen vision-language instruct model for visual reasoning, documents, and agent tasks
- **Input / output:** text, image / text.
- **Context / maximum output:** 262,144 / 262,000 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.53 / output $2.66 per 1M tokens

### Qwen3-Next 80B-A3B Instruct

- **Bedrock model ID:** `qwen.qwen3-next-80b-a3b`
- **Built by:** Qwen (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-qwen.html)).
- **Intended/documented use:** Qwen instruction model for multilingual chat, reasoning, and tool use
- **Input / output:** text / text.
- **Context / maximum output:** 262,144 / 262,000 tokens.
- **Tools / reasoning:** tool calling; reasoning not listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $0.15 / output $1.2 per 1M tokens

## Z.AI

### GLM-5

- **Bedrock model ID:** `zai.glm-5`
- **Built by:** Z.AI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-zai.html)).
- **Intended/documented use:** General GLM flagship for coding, analysis, and tool-heavy engineering workflows
- **Input / output:** text / text.
- **Context / maximum output:** 202,752 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $1 / output $3.2 per 1M tokens

## xAI

### Grok 4.3

- **Bedrock model ID:** `xai.grok-4.3`
- **Built by:** xAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-xai.html)).
- **Intended/documented use:** xAI's default Grok for chat, coding, agentic tools, and lower hallucination risk
- **Input / output:** text, image / text.
- **Context / maximum output:** 1,000,000 / 131,072 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $1.25 / output $2.5 per 1M tokens
- Cache read: $0.2 per 1M tokens

### Grok 4.6

- **Bedrock model ID:** `xai.grok-4.6`
- **Built by:** xAI (see [AWS provider model cards](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-xai.html)).
- **Intended/documented use:** xAI's frontier model for long-running agents, coding, knowledge work, and visual projects
- **Input / output:** text, image / text.
- **Context / maximum output:** 500,000 / 500,000 tokens.
- **Tools / reasoning:** tool calling; reasoning support listed.
- **Data retention:** No model-specific retention rule was identified in the cited AWS general documentation. Do not interpret this as a guarantee of zero retention; check the current model terms and account data-retention configuration.
- **Pricing (USD, per 1M tokens):**
- Standard rate: input $2.2 / output $6.6 per 1M tokens
- Cache read: $0.55 per 1M tokens
