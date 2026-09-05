import { z } from "zod";
import { analyzeEvent } from "@/lib/extract";
import { checkLlmBudget, clientIpFrom } from "@/lib/rateLimit";

// A news snippet worth analysing is a few paragraphs, not a whole article.
// The old 20k ceiling was an invitation to burn tokens on a public endpoint.
export const MAX_INPUT_CHARS = 4_000;

const RequestSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_CHARS),
});

/** Zod's raw issue list is unreadable on screen — say what to do instead. */
function humanValidationMessage(body: unknown): string {
  const text = typeof body === "object" && body !== null ? (body as { text?: unknown }).text : undefined;

  if (typeof text !== "string" || text.trim().length === 0) {
    return "Paste some article text first — the request had no text in it.";
  }
  if (text.length > MAX_INPUT_CHARS) {
    return (
      `That snippet is ${text.length.toLocaleString()} characters and this endpoint accepts up to ` +
      `${MAX_INPUT_CHARS.toLocaleString()}. Paste the paragraphs that name the companies rather than a whole article.`
    );
  }
  return "That request wasn't in a shape this endpoint understands.";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ abstain: true, abstainReason: "Request body was not valid JSON." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ abstain: true, abstainReason: humanValidationMessage(body) }, { status: 400 });
  }

  // Over budget serves the local extractor rather than an error: the endpoint
  // is public, and a demo that returns 429s to a judge is worse than one that
  // transparently degrades to the baseline.
  const { llmAllowed, reason } = checkLlmBudget(clientIpFrom(request));

  const result = await analyzeEvent(parsed.data.text, { allowLlm: llmAllowed, fallbackNote: reason });
  return Response.json(result);
}
