import { z } from "zod";
import { analyzeEvent } from "@/lib/extract";
import { checkLlmBudget, clientIpFrom } from "@/lib/rateLimit";

// A news snippet worth analysing is a few paragraphs, not a novel. The old
// 20k ceiling was an invitation to burn tokens on a public endpoint.
const RequestSchema = z.object({
  text: z.string().min(1).max(4_000),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ abstain: true, abstainReason: "Request body was not valid JSON." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { abstain: true, abstainReason: `Invalid request: ${parsed.error.message}` },
      { status: 400 }
    );
  }

  // Over budget serves the local extractor rather than an error: the endpoint
  // is public, and a demo that returns 429s to a judge is worse than one that
  // transparently degrades to the baseline.
  const { llmAllowed, reason } = checkLlmBudget(clientIpFrom(request));

  const result = await analyzeEvent(parsed.data.text, { allowLlm: llmAllowed, fallbackNote: reason });
  return Response.json(result);
}
