export type SocialConnectMode = "meta" | "twitter" | "google" | "manual";

export const SUPPORTED_PLATFORMS = [
  { id: "facebook",  name: "Facebook",  icon: "📘", color: "#1877F2", oauth: true,  connectMode: "meta" },
  { id: "instagram", name: "Instagram", icon: "📷", color: "#E4405F", oauth: true,  connectMode: "meta" },
  { id: "twitter",   name: "X (Twitter)", icon: "🐦", color: "#000000", oauth: true,  connectMode: "twitter" },
  { id: "linkedin",  name: "LinkedIn",  icon: "💼", color: "#0A66C2", oauth: false, connectMode: "manual" },
  { id: "youtube",   name: "YouTube",   icon: "▶️", color: "#FF0000", oauth: true,  connectMode: "google" },
  { id: "tiktok",    name: "TikTok",    icon: "🎵", color: "#000000", oauth: false, connectMode: "manual" },
  { id: "threads",   name: "Threads",   icon: "🧵", color: "#000000", oauth: false, connectMode: "manual" },
  { id: "reddit",    name: "Reddit",    icon: "👽", color: "#FF4500", oauth: false, connectMode: "manual" },
  { id: "pinterest", name: "Pinterest", icon: "📌", color: "#BD081C", oauth: false, connectMode: "manual" },
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
