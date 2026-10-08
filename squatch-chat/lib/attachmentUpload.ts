// Client-side private attachment upload shared by channel messages and DMs.
// The file goes to /api/attachments (owner-bound, pending); the caller then
// sends a message with the returned attachmentId, and the message route claims
// it server-side (lib/privateUploads.ts).
import { ensureRuntimeConfig } from "@/hooks/useRuntimeConfig";
import { evaluateUploadPolicy } from "@/lib/uploadPolicy";
import { toast } from "@/lib/toast";

// Mirrors the server allow-list in lib/uploadPolicy.ts (voice notes use the recorder).
export const UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/zip,.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.zip";

export interface UploadedAttachment {
  attachmentId: string;
  url: string;
  name: string;
}

/** Upload one file with progress (0–100). Rejects with a user-facing message. */
export function uploadPrivateAttachment(
  file: File,
  onProgress: (pct: number) => void,
): Promise<UploadedAttachment> {
  const formData = new FormData();
  formData.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      let response: { attachmentId?: string; url?: string; name?: string; error?: string } = {};
      try {
        response = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the generic upload error below.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (response.attachmentId && response.url && response.name) {
          resolve({ attachmentId: response.attachmentId, url: response.url, name: response.name });
        } else {
          reject(new Error("Upload response was incomplete"));
        }
      } else {
        reject(new Error(response.error || (xhr.status === 413 ? "File too large for this server." : "Upload failed")));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed — check your connection.")));
    xhr.open("POST", "/api/attachments");
    xhr.send(formData);
  });
}

/** Client-side mirror of the server's upload policy so bad files fail fast with the same message. */
export async function checkUploadAllowed(file: File): Promise<boolean> {
  const config = await ensureRuntimeConfig();
  const configured = (config as { maxUploadBytes?: unknown }).maxUploadBytes;
  const maxBytes = typeof configured === "number" && configured > 0 ? configured : Number.POSITIVE_INFINITY;
  const policy = evaluateUploadPolicy({ name: file.name, type: file.type, size: file.size }, maxBytes);
  if (!policy.allowed) {
    toast(policy.error, "error");
    return false;
  }
  return true;
}
