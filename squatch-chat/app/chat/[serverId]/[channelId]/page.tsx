import { redirect } from "next/navigation";

export default function ChannelPage() {
  // All chat routing is handled by the main /chat page with client-side state
  redirect("/chat");
}
