import Image from "next/image";
import { customEmojiToken, isSafeCustomEmojiUrl } from "@/lib/customEmoji";

/** One custom server emoji. Unsafe URLs fall back to the plain `:name:` text. */
export default function CustomEmojiImage({
  name,
  url,
  size = 22,
  className = "",
}: {
  name: string;
  url: string;
  size?: number;
  className?: string;
}) {
  const token = customEmojiToken(name);
  if (!isSafeCustomEmojiUrl(url)) return <>{token}</>;
  return (
    <Image
      src={url}
      alt={token}
      title={token}
      width={size}
      height={size}
      unoptimized
      draggable={false}
      className={`inline-block object-contain ${className}`}
    />
  );
}
