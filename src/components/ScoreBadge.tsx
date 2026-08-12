import { scoreBadgeClass } from "@/lib/rankmath";

export default function ScoreBadge({
  score,
  className = "",
}: {
  score: number | null | undefined;
  className?: string;
}) {
  if (score == null) return null;
  return (
    <span
      title={`Rank Math-style on-page SEO score: ${score}/100`}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${scoreBadgeClass(score)} ${className}`}
    >
      SEO {score}/100
    </span>
  );
}
