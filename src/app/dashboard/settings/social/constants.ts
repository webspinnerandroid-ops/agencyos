export const SUPPORTED_PLATFORMS = [
  { id: "facebook",  name: "Facebook",  icon: "📘", color: "#1877F2", oauth: true  },
  { id: "instagram", name: "Instagram", icon: "📷", color: "#E4405F", oauth: true  },
  { id: "twitter",   name: "X (Twitter)", icon: "🐦", color: "#000000", oauth: false },
  { id: "linkedin",  name: "LinkedIn",  icon: "💼", color: "#0A66C2", oauth: false },
  { id: "youtube",   name: "YouTube",   icon: "▶️", color: "#FF0000", oauth: false },
  { id: "tiktok",    name: "TikTok",    icon: "🎵", color: "#000000", oauth: false },
  { id: "threads",   name: "Threads",   icon: "🧵", color: "#000000", oauth: false },
  { id: "pinterest", name: "Pinterest", icon: "📌", color: "#BD081C", oauth: false },
] as const;

export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];