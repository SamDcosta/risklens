import { z } from "zod";
import { analyzeEvent } from "@/lib/llm/analyzeEvent";

const RequestSchema = z.object({
  text: z.string().min(1).max(20_000),
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

  const result = await analyzeEvent(parsed.data.text);
  return Response.json(result);
}
