import { NextResponse } from "next/server";
import { analyse } from "@/server/analyst";
import { loadBundle } from "@/server/bundle";

export async function POST(req: Request) {
  const body = (await req.json()) as { question?: string; postcode?: string; networkId?: string };
  if (!body.question?.trim()) return NextResponse.json({ error: "question required" }, { status: 400 });
  try {
    const bundle = await loadBundle(body.networkId || "endeavour-energy");
    return NextResponse.json(analyse(body.question, bundle, body.postcode));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 404 });
  }
}
