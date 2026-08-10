"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from "@react-pdf/renderer";
import { format, parseISO } from "date-fns";

// ------------------------------------------------------------------
// Types (mirrored from page)
// ------------------------------------------------------------------

interface AnalyticsSummary {
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  totalEngagement: number;
  avgEngagementRate: number;
  topPost: {
    id: string;
    content: string;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
  } | null;
}

interface AnalyticsPost {
  id: string;
  content: string | null;
  scheduled_at: string | null;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalImpressions: number;
  engagementRate: number;
}

// ------------------------------------------------------------------
// Styles
// ------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 12,
    color: "#1a1a1a",
  },
  header: {
    marginBottom: 24,
    borderBottom: "2px solid #3b82f6",
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#6b7280",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 10,
    color: "#374151",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  summaryCard: {
    width: "30%",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 9,
    color: "#6b7280",
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: "bold",
  },
  topPostCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    backgroundColor: "#f9fafb",
  },
  topPostLabel: {
    fontSize: 10,
    color: "#6b7280",
    marginBottom: 4,
  },
  topPostContent: {
    fontSize: 12,
    fontStyle: "italic",
    marginBottom: 6,
  },
  topPostMetrics: {
    fontSize: 10,
    color: "#4b5563",
  },
  chartPlaceholder: {
    border: "1px dashed #d1d5db",
    borderRadius: 6,
    padding: 20,
    marginBottom: 16,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  chartTitle: {
    fontSize: 10,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 12,
  },
  chartBars: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 80,
  },
  chartBar: {
    width: 20,
    backgroundColor: "#3b82f6",
    borderRadius: 2,
  },
  chartBarAmber: {
    width: 20,
    backgroundColor: "#f59e0b",
    borderRadius: 2,
  },
  chartBarLabel: {
    fontSize: 7,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
  },
  table: {
    width: "100%",
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: 6,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#6b7280",
  },
  tableRow: {
    flexDirection: "row",
    borderBottom: "1px solid #f3f4f6",
    paddingVertical: 4,
  },
  tableCell: {
    fontSize: 9,
  },
  colContent: { width: "30%", paddingRight: 4 },
  colDate: { width: "18%" },
  colLikes: { width: "13%", textAlign: "right" },
  colComments: { width: "13%", textAlign: "right" },
  colShares: { width: "13%", textAlign: "right" },
  colEngagement: { width: "13%", textAlign: "right" },
  footer: {
    marginTop: 30,
    paddingTop: 12,
    borderTop: "1px solid #e5e7eb",
    fontSize: 9,
    color: "#9ca3af",
    textAlign: "center",
  },
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

// ------------------------------------------------------------------
// PDF Document Component
// ------------------------------------------------------------------

interface AnalyticsPDFProps {
  summary: AnalyticsSummary;
  posts: AnalyticsPost[];
}

function AnalyticsPDFDocument({ summary, posts }: AnalyticsPDFProps) {
  const topPosts = [...posts]
    .sort(
      (a, b) =>
        b.totalLikes +
        b.totalComments +
        b.totalShares -
        (a.totalLikes + a.totalComments + a.totalShares)
    )
    .slice(0, 10);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Agency OS — Analytics Report</Text>
          <Text style={styles.subtitle}>
            Generated on{" "}
            {format(new Date(), "MMMM d, yyyy 'at' h:mm a")}
          </Text>
        </View>

        {/* Summary Cards */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Posts</Text>
            <Text style={styles.summaryValue}>{summary.totalPosts}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Likes</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.totalLikes)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Comments</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.totalComments)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Shares</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.totalShares)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Impressions</Text>
            <Text style={styles.summaryValue}>
              {formatNumber(summary.totalImpressions)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Engagement Rate</Text>
            <Text style={styles.summaryValue}>
              {summary.avgEngagementRate}%
            </Text>
          </View>
        </View>

        {/* Top Performing Post */}
        {summary.topPost && (
          <>
            <Text style={styles.sectionTitle}>Top Performing Post</Text>
            <View style={styles.topPostCard}>
              <Text style={styles.topPostContent}>
                {summary.topPost.content || "No content"}
              </Text>
              <Text style={styles.topPostMetrics}>
                👍 {summary.topPost.totalLikes} · 💬{" "}
                {summary.topPost.totalComments} · 🔄{" "}
                {summary.topPost.totalShares}
              </Text>
            </View>
          </>
        )}

        {/* Chart Placeholder (Likes vs Comments) */}
        <Text style={styles.sectionTitle}>
          Engagement Trend (Likes & Comments)
        </Text>
        <View style={styles.chartPlaceholder}>
          <Text style={styles.chartTitle}>
            Daily aggregated likes (blue) and comments (amber)
          </Text>
          <View style={styles.chartBars}>
            {/* Render up to 10 bars as a visual representation */}
            {topPosts.slice(0, 10).map((p, i) => {
              const maxLikes = Math.max(
                ...topPosts.slice(0, 10).map((x) => x.totalLikes),
                1
              );
              const likeHeight = Math.max(
                (p.totalLikes / maxLikes) * 70,
                4
              );
              const maxComments = Math.max(
                ...topPosts.slice(0, 10).map((x) => x.totalComments),
                1
              );
              const commentHeight = Math.max(
                (p.totalComments / maxComments) * 70,
                4
              );
              return (
                <View key={i} style={{ alignItems: "center" }}>
                  <View style={{ flexDirection: "row", gap: 2 }}>
                    <View
                      style={[
                        styles.chartBar,
                        { height: likeHeight },
                      ] as never}
                    />
                    <View
                      style={[
                        styles.chartBarAmber,
                        { height: commentHeight },
                      ] as never}
                    />
                  </View>
                  <Text style={styles.chartBarLabel}>
                    {p.scheduled_at
                      ? format(parseISO(p.scheduled_at), "M/d")
                      : "—"}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Post Performance Table */}
        <Text style={styles.sectionTitle}>Post Performance</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colContent]}>
              Content
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colDate]}>
              Date
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colLikes]}>
              Likes
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colComments]}>
              Com.
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colShares]}>
              Shares
            </Text>
            <Text style={[styles.tableHeaderCell, styles.colEngagement]}>
              Eng. %
            </Text>
          </View>
          {posts.slice(0, 25).map((post) => (
            <View style={styles.tableRow} key={post.id}>
              <Text style={[styles.tableCell, styles.colContent]}>
                {(post.content ?? "").slice(0, 40)}
              </Text>
              <Text style={[styles.tableCell, styles.colDate]}>
                {post.scheduled_at
                  ? format(parseISO(post.scheduled_at), "MMM d")
                  : "—"}
              </Text>
              <Text style={[styles.tableCell, styles.colLikes]}>
                {formatNumber(post.totalLikes)}
              </Text>
              <Text style={[styles.tableCell, styles.colComments]}>
                {formatNumber(post.totalComments)}
              </Text>
              <Text style={[styles.tableCell, styles.colShares]}>
                {formatNumber(post.totalShares)}
              </Text>
              <Text style={[styles.tableCell, styles.colEngagement]}>
                {post.engagementRate}%
              </Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <Text style={styles.footer}>Generated by Agency OS</Text>
      </Page>
    </Document>
  );
}

// ------------------------------------------------------------------
// Helper: generate PDF blob from data
// ------------------------------------------------------------------

export async function generateAnalyticsPDFBlob(
  summary: AnalyticsSummary,
  posts: AnalyticsPost[]
): Promise<Blob> {
  const blob = await pdf(
    <AnalyticsPDFDocument summary={summary} posts={posts} />
  ).toBlob();
  return blob;
}

export { AnalyticsPDFDocument };