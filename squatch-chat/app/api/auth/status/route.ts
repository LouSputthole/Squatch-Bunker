import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { statusMessage } = await req.json();
  if (statusMessage && statusMessage.length > 128) {
    return NextResponse.json({ error: "Status too long (max 128 chars)" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.userId },
    data: { statusMessage: statusMessage || null },
  });

  return NextResponse.json({ statusMessage: user.statusMessage });
}
