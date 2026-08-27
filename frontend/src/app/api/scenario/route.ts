import { NextResponse } from "next/server";
import { scenarioShift } from "@/server/brief";
import { loadBundle } from "@/server/bundle";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    networkId?: string;
    postcode?: string;
    homes?: number;
    solarMw?: number;
    batteryMwh?: number;
    evChargers?: number;
    commercialMw?: number;
  };
  if (!body.postcode) return NextResponse.json({ error: "postcode required" }, { status: 400 });
  try {
    const bundle = await loadBundle(body.networkId || "endeavour-energy");
    return NextResponse.json(
      scenarioShift(bundle, body.postcode, {
        homes: body.homes || 0,
        solarMw: body.solarMw || 0,
        batteryMwh: body.batteryMwh || 0,
        evChargers: body.evChargers || 0,
        commercialMw: body.commercialMw || 0,
      })
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 404 });
  }
}
