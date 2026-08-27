import { NextResponse } from "next/server";
import { meetingPack } from "@/server/brief";
import { loadBundle } from "@/server/bundle";

export async function POST(req: Request) {
  const body = (await req.json()) as { networkId?: string; topic?: string; postcode?: string };
  try {
    const bundle = await loadBundle(body.networkId || "endeavour-energy");
    return NextResponse.json(meetingPack(bundle, body.topic || "general discovery", body.postcode));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 404 });
  }
}
