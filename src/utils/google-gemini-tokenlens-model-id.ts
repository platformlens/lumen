import { getTokenCosts } from "tokenlens";

const FALLBACK_GOOGLE_MODEL_FOR_COST = "google:gemini-2.5-flash";

/** API id → tokenlens catalog id (see @tokenlens/models/providers/google). */
const GEMINI_TOKENLENS_ALIASES: Record<string, string> = {
  "gemini-2.0-flash-exp": "gemini-2.0-flash",
  "gemini-2.0-flash-thinking-exp-1219": "gemini-2.0-flash",
  "gemini-exp-1206": "gemini-2.5-flash",
};

function tokenlensHasUsdPricing(modelId: string): boolean {
  const { totalUSD } = getTokenCosts({
    modelId,
    usage: { input: 1_000_000, output: 1_000_000 },
  });
  return typeof totalUSD === "number" && Number.isFinite(totalUSD);
}

/**
 * Map the Gemini model id from settings/API to a tokenlens catalog id so getUsage can price it.
 * Preview and renamed models often omit tokenlens entries; we alias or fall back to a priced sibling.
 */
export function googleGeminiTokenlensModelId(apiModelId: string): string {
  const raw = apiModelId.trim().toLowerCase();
  if (!raw) return FALLBACK_GOOGLE_MODEL_FOR_COST;

  const candidates: string[] = [];
  const prefixed = `google:${raw}`;
  candidates.push(prefixed);

  const aliased = GEMINI_TOKENLENS_ALIASES[raw];
  if (aliased) candidates.push(`google:${aliased}`);

  const stripped = raw
    .replace(/-latest$/i, "")
    .replace(/@[a-z0-9._-]+$/i, "");
  if (stripped !== raw) candidates.push(`google:${stripped}`);

  for (const id of candidates) {
    if (tokenlensHasUsdPricing(id)) return id;
  }

  return FALLBACK_GOOGLE_MODEL_FOR_COST;
}
