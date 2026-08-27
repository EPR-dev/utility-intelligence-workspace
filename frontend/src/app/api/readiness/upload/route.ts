import { NextResponse } from "next/server";
import { inspectUpload } from "@/server/readiness";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 4_500_000) return NextResponse.json({ error: "File too large for this demo (4.5 MB)." }, { status: 400 });
  try {
    const result = await inspectUpload(
      file.name || "upload.csv",
      await file.arrayBuffer(),
      String(fd.get("datasetKind") || "feeder"),
      String(fd.get("useCase") || "flexible_exports")
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
