/**
 * Review notifications for learners: submissions an admin has reviewed since the learner last
 * looked. Reads only the learner's own rows (RLS). "Seen" is per browser.
 */
import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import type { ReviewStatus } from "./projects";

export interface MyReview {
  id: number;
  project_slug: string;
  status: ReviewStatus;
  review_comment: string | null;
  reviewed_at: string;
}

const SEEN = "sqlp.reviews.seen";
const CHANGED = "sqlp-reviews-seen";

export const reviewsSeenAt = (): string => {
  try { return localStorage.getItem(SEEN) ?? ""; } catch { return ""; }
};
export function markReviewsSeen(at = new Date().toISOString()) {
  try { localStorage.setItem(SEEN, at); } catch { /* ignore */ }
  window.dispatchEvent(new Event(CHANGED));
}
export const unseenCount = (rows: Pick<MyReview, "reviewed_at">[], seenAt: string) => rows.filter((r) => r.reviewed_at > seenAt).length;

export async function fetchMyReviews(userId: string): Promise<MyReview[]> {
  const sb = await getSupabase();
  const { data, error } = await sb.from("project_submissions")
    .select("id, project_slug, status, review_comment, reviewed_at")
    .eq("user_id", userId).not("reviewed_at", "is", null)
    .order("reviewed_at", { ascending: false }).limit(50);
  return error ? [] : ((data ?? []) as MyReview[]);
}

/** The learner's reviewed submissions and how many are new. Null user = signed out. */
export function useMyReviews(userId: string | null | undefined) {
  const [rows, setRows] = useState<MyReview[]>([]);
  const [seen, setSeen] = useState("");
  useEffect(() => {
    setSeen(reviewsSeenAt());
    const on = () => setSeen(reviewsSeenAt());
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  useEffect(() => {
    if (!userId) return setRows([]);
    let live = true;
    void fetchMyReviews(userId).then((r) => live && setRows(r));
    return () => { live = false; };
  }, [userId]);
  return { rows, unseen: unseenCount(rows, seen), seen };
}
