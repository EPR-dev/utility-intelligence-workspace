import { NextResponse } from "next/server";
import { printHtml, renderMarkdown } from "@/server/brief";
import { loadBundle } from "@/server/bundle";

export async function POST(req: Request) {
  const body = (await req.json()) as { networkId?: string; format?: string; topic?: string };
  try {
    const bundle = await loadBundle(body.networkId || "endeavour-energy");
    const md = renderMarkdown(bundle, body.topic);
    if (body.format === "html") {
      return new NextResponse(printHtml(md), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 404 });
  }
}
