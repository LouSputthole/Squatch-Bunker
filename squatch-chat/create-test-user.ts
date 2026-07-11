import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const email = "test@gmail.com";
  const username = "test";
  const password = "test";

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { email, username, passwordHash, isGuest: false, guestExpiresAt: null },
    });
    console.log("Updated existing user:", existing.id, email);
  } else {
    const user = await prisma.user.create({
      data: { email, username, passwordHash },
    });
    console.log("Created user:", user.id, email);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
