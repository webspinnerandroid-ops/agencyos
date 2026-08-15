import { scoreBadgeClass } from "@/lib/seo-scorer";

export default function ScoreBadge({
  score,
  className = "",
  label = "SEO",
}: {
  score: number | null | undefined;
  className?: string;
  label?: string;
}) {
  if (score == null) return null;
  return (
    <span
      title={`${label} readiness score: ${score}/100`}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${scoreBadgeClass(score)} ${className}`}
    >
      {label} {score}/100
    </span>
  );
}
