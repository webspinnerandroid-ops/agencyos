/**
 * Resolve the canonical URL of a published post on its social platform.
 *
 * The publisher stores the platform's post id (post_platforms.platform_post_id)
 * and — when the provider returns one — the full post URL
 * (post_platforms.platform_post_url). When no URL was captured, a canonical
 * URL is derived from the post id for platforms where that is possible
 * without extra data (X/Twitter, LinkedIn, Instagram, Facebook).
 */

const INSTAGRAM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Instagram numeric media id -> base64url-ish shortcode (works without a username). */
export function mediaIdToShortcode(mediaId: string): string | null {
  if (!/^\d+$/.test(mediaId)) return null;
  let num = BigInt(mediaId);
  let out = "";
  const zero = BigInt(0);
  const sixtyFour = BigInt(64);
  while (num > zero) {
    out = INSTAGRAM_ALPHABET[Number(num % sixtyFour)] + out;
    num /= sixtyFour;
  }
  return out || null;
}

export function platformPostUrl(
  platform: string,
  platformPostId: string | null | undefined,
  storedUrl?: string | null
): string | null {
  if (storedUrl && /^https?:\/\//.test(storedUrl)) return storedUrl;
  const id = (platformPostId ?? "").trim();
  if (!id) return null;

  switch (platform) {
    case "twitter":
    case "x":
      // Works for any tweet id without needing the username.
      return `https://x.com/i/web/status/${id}`;
    case "linkedin": {
      // Accept a bare id or a full URN (e.g. urn:li:share:123456789).
      const urn = id.startsWith("urn:") ? id : `urn:li:share:${id}`;
      return `https://www.linkedin.com/feed/update/${urn}`;
    }
    case "instagram": {
      const shortcode = mediaIdToShortcode(id);
      if (shortcode) return `https://www.instagram.com/p/${shortcode}/`;
      return null;
    }
    case "facebook":
      return /^\d+$/.test(id)
        ? `https://www.facebook.com/story.php?story_fbid=${id}`
        : null;
    default:
      // TikTok / Threads / others need a profile handle we don't reliably
      // store — only link when the provider gave us a real URL.
      return null;
  }
}
