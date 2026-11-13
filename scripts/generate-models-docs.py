#!/usr/bin/env python3
"""Generate docs/MODELS.md from the bundled models.dev Bedrock registry."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CACHE = ROOT / "src/models-dev-cache.json"
DEFAULT_OUTPUT = ROOT / "docs/MODELS.md"
PROVIDERS = {
    "ai21": ("AI21 Labs", "ai21-labs"),
    "amazon": ("Amazon", "amazon"),
    "anthropic": ("Anthropic", "anthropic"),
    "cohere": ("Cohere", "cohere"),
    "deepseek": ("DeepSeek", "deepseek"),
    "google": ("Google", "google"),
    "meta": ("Meta", "meta"),
    "minimax": ("MiniMax", "minimax"),
    "mistral": ("Mistral AI", "mistral-ai"),
    "moonshot": ("Moonshot AI", "moonshot-ai"),
    "moonshotai": ("Moonshot AI", "moonshot-ai"),
    "nvidia": ("NVIDIA", "nvidia"),
    "openai": ("OpenAI", "openai"),
    "qwen": ("Qwen", "qwen"),
    "stability": ("Stability AI", "stability"),
    "twelvelabs": ("TwelveLabs", "twelvelabs"),
    "writer": ("Writer", "writer"),
    "xai": ("xAI", "xai"),
    "zai": ("Z.AI", "zai"),
}

FABLE_IDS = {
    "anthropic.claude-fable-5",
    "anthropic.claude-fable-5-1",
    "anthropic.claude-fable-5-2",
    "eu.anthropic.claude-fable-5",
    "global.anthropic.claude-fable-5",
    "global.anthropic.claude-fable-5-1",
    "global.anthropic.claude-fable-5-2",
}
OPENAI_ZDR_EXCEPTIONS = ("gpt-oss-safeguard", "gpt-oss-120b", "gpt-oss-20b")
INFERENCE_PROFILE_PREFIXES = {
    "apac",
    "au",
    "ca",
    "eu",
    "global",
    "in",
    "jp",
    "us",
    "us-gov",
}


def usd(value: float) -> str:
    return f"${value:,.4f}".rstrip("0").rstrip(".")


def model_provider(model_id: str, entry: dict) -> tuple[str, str, str]:
    canonical = str(entry.get("canonical_model_id", ""))
    provider_key = canonical.split("/", 1)[0] if "/" in canonical else ""
    if provider_key not in PROVIDERS:
        # IDs may be regional inference profiles, e.g. eu.anthropic.foo.
        pieces = model_id.split(".")
        provider_key = next((part for part in pieces if part in PROVIDERS), "")
    if not provider_key:
        return "Not identified in registry", "", ""
    name, slug = PROVIDERS[provider_key]
    return name, slug, provider_key


def display_modalities(values: object) -> str:
    if not isinstance(values, list) or not values:
        return "Not specified in registry"
    return ", ".join(str(value) for value in values)


def retention_note(model_id: str, provider_key: str) -> str:
    normalized = model_id.lower()
    if "claude-fable-5" in normalized:
        return (
            "**AWS review required.** AWS documents up to 30-day retention of all prompts and "
            "completions within AWS; classifier-flagged traffic may receive human review by AWS. "
            "The provider does not receive the content. Account data-retention mode must permit "
            "`aws_review` (legacy `provider_data_share` also satisfies this). Eligible Enterprise "
            "Frontier Safeguards customers may have a model-specific ZDR exception."
        )
    if provider_key == "openai" and not any(
        value in normalized for value in OPENAI_ZDR_EXCEPTIONS
    ):
        return (
            "AWS documents retention of classifier-flagged traffic for up to 30 days for "
            "automated offline abuse detection; eligible customers may request full ZDR. "
            "See AWS's model-specific abuse-detection terms."
        )
    if provider_key == "anthropic":
        return (
            "No additional retention change is documented for Claude models released before "
            "Fable 5. AWS's general abuse-detection and account data-retention terms still apply; "
            "verify the exact model's current terms."
        )
    return (
        "No model-specific retention rule was identified in the cited AWS general documentation. "
        "Do not interpret this as a guarantee of zero retention; check the current model terms "
        "and account data-retention configuration."
    )


def price_rows(entry: dict) -> list[str]:
    cost = entry.get("cost")
    if not isinstance(cost, dict) or "input" not in cost or "output" not in cost:
        return ["Pricing: not available in the bundled registry."]

    def pair(label: str, item: dict) -> str:
        return (
            f"- {label}: input {usd(float(item['input']))} / output "
            f"{usd(float(item['output']))} per 1M tokens"
        )

    rows = [pair("Standard rate", cost)]
    explicit_context_tiers = [
        value
        for key, value in cost.items()
        if key.startswith("context_over_") and isinstance(value, dict)
    ]
    for tier in cost.get("tiers", []):
        threshold = tier.get("tier", {})
        if "input" in tier and "output" in tier:
            if any(
                all(tier.get(key) == explicit.get(key) for key in ("input", "output"))
                for explicit in explicit_context_tiers
            ):
                continue
            if threshold.get("type") == "context" and "size" in threshold:
                label = f"Context tier above {int(threshold['size']):,} tokens"
            else:
                label = f"Tier ({threshold.get('type', 'unspecified')}: {threshold.get('size', 'unspecified')})"
            rows.append(pair(label, tier))
    for key, value in cost.items():
        if key.startswith("context_over_") and isinstance(value, dict):
            if "input" in value and "output" in value:
                threshold = key.removeprefix("context_over_").replace("k", ",000")
                rows.append(pair(f"Context above {threshold} tokens", value))
    for key, label in (("cache_read", "Cache read"), ("cache_write", "Cache write")):
        if key in cost:
            rows.append(f"- {label}: {usd(float(cost[key]))} per 1M tokens")
    return rows


def build_markdown(cache_path: Path) -> str:
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    models = payload.get("amazon-bedrock", {}).get("models")
    if not isinstance(models, dict):
        raise ValueError(f"No amazon-bedrock.models object found in {cache_path}")

    canonical_models = {
        model_id: entry
        for model_id, entry in models.items()
        if model_id.split(".", 1)[0] not in INFERENCE_PROFILE_PREFIXES
        and str(entry.get("status", "")).lower() != "deprecated"
    }

    groups: dict[str, list[tuple[str, dict]]] = {}
    for model_id, entry in sorted(
        canonical_models.items(), key=lambda item: item[1].get("name", item[0]).lower()
    ):
        provider, _, _ = model_provider(model_id, entry)
        groups.setdefault(provider, []).append((model_id, entry))

    lines = [
        "# Amazon Bedrock model catalogue",
        "",
        f"> Generated from `{cache_path.relative_to(ROOT) if cache_path.is_relative_to(ROOT) else cache_path}`. "
        "The cache is the `models.dev` Amazon Bedrock registry snapshot, not an AWS price quote.",
        "> Prices below retain the registry's USD-per-1M-token values; no currency conversion is applied.",
        "> AWS bills according to the selected model, inference mode, region, applicable price "
        "tiers, caching, and other features. Confirm live prices before deployment.",
        "> Target region: **Europe (Ireland), `eu-west-1`**. An `eu.` inference-profile row is "
        "used where available; this profile can route across its supported EU regions and is not "
        "a guarantee that inference runs only in Ireland. Otherwise the registry's base model "
        "rate is shown. Use regional inference profiles if residency policy requires them.",
        "",
        "## Sources and interpretation",
        "",
        "- [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — authoritative live pricing.",
        "- [AWS models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) — model providers and model cards.",
        "- [AWS data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) and [data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html).",
        "- [AWS abuse detection and model-specific terms](https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html).",
        "- [models.dev registry](https://models.dev/) supplies the bundled model descriptions, modalities, limits, and USD price estimates; these descriptions are concise intended-use summaries, not independent AWS endorsements.",
        "- Modalities, token limits, tool support, and prices reflect the bundled registry snapshot. Missing details mean the cache does not specify them.",
        "",
        f"This catalogue contains **{len(canonical_models)} base model IDs**. Region-prefixed and global inference-profile IDs are omitted; use the `eu.` profile when EU-region inference routing is required.",
        "",
    ]

    for provider in sorted(groups):
        lines.extend([f"## {provider}", ""])
        for model_id, entry in groups[provider]:
            name = str(entry.get("name", model_id))
            _, provider_slug, provider_key = model_provider(model_id, entry)
            provider_url = (
                f"https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-{provider_slug}.html"
                if provider_slug
                else "https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html"
            )
            modalities = entry.get("modalities", {})
            input_modalities = display_modalities(
                modalities.get("input") if isinstance(modalities, dict) else None
            )
            output_modalities = display_modalities(
                modalities.get("output") if isinstance(modalities, dict) else None
            )
            description = str(
                entry.get("description", "No use-case description in registry.")
            )
            limits = entry.get("limit", {})
            status = entry.get("status")
            lines.extend(
                [
                    f"### {name}",
                    "",
                    f"- **Bedrock model ID:** `{model_id}`",
                    f"- **Built by:** {provider} (see [AWS provider model cards]({provider_url})).",
                    f"- **Intended/documented use:** {description}",
                    f"- **Input / output:** {input_modalities} / {output_modalities}.",
                    f"- **Context / maximum output:** {int(limits['context']):,} / {int(limits['output']):,} tokens."
                    if isinstance(limits, dict)
                    and isinstance(limits.get("context"), (int, float))
                    and isinstance(limits.get("output"), (int, float))
                    else "- **Context / maximum output:** not specified in registry.",
                    f"- **Tools / reasoning:** {'tool calling' if entry.get('tool_call') else 'tool calling not specified/supported'}; "
                    f"{'reasoning support listed' if entry.get('reasoning') else 'reasoning not listed'}.",
                    f"- **Data retention:** {retention_note(model_id, provider_key)}",
                    "- **Pricing (USD, per 1M tokens):**",
                    *price_rows(entry),
                ]
            )
            if status:
                lines.append(f"- **Registry status:** {status}.")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cache", type=Path, default=DEFAULT_CACHE, help="models-dev-cache.json path"
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="Markdown output path"
    )
    args = parser.parse_args()

    try:
        markdown = build_markdown(args.cache)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(markdown, encoding="utf-8")
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"Generated {args.output} from {args.cache} (prices shown in USD).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
