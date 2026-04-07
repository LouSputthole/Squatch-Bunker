import { prisma } from "@/lib/db";

export async function createSystemMessage(channelId: string, content: string, authorId: string) {
  return prisma.message.create({
    data: {
      channelId,
      authorId, // Use system user or a placeholder user id
      content,
      isSystem: true,
    },
  });
}
