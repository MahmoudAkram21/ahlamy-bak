const seededReviewText: Record<string, { reviewerName: string; content: string }> = {
  "seed-review-maryam": {
    reviewerName: "مريم.س",
    content: "جزاكم الله خيراً على المنصة، التفسير كان دقيقاً ومطمئناً جداً.",
  },
  "seed-review-abdullah": {
    reviewerName: "عبدالله.م",
    content: "سرعة الرد وجودة التفسير كانت رائعة، شكراً لفريق أحلامي.",
  },
  "seed-review-fatima": {
    reviewerName: "فاطمة.أ",
    content: "تعامل محترم وسرعة في الرد، التفسير كان واضحاً ومرتباً وساعدني أفهم رؤياي بشكل أفضل.",
  },
  "seed-review-ahmed": {
    reviewerName: "أحمد.م",
    content: "منصة موثوقة ومفيدة، أنصح بها كل من يبحث عن تفسير رؤى وفق المنهج الإسلامي.",
  },
  "seed-review-noura": {
    reviewerName: "نورة.خ",
    content: "تجربة ممتازة، المفسرون متعاونون والشرح كان يسيراً على الفهم.",
  },
};

function looksCorrupted(value: unknown) {
  if (typeof value !== "string") return false;
  const questionMarks = (value.match(/\?/g) || []).length;
  const hasArabic = /[\u0600-\u06ff]/.test(value);
  return !hasArabic && questionMarks >= 2;
}

export function normalizeReviewText<T extends { id: string; reviewerName: string; content: string }>(review: T): T {
  const fallback = seededReviewText[review.id];
  if (!fallback) return review;

  return {
    ...review,
    reviewerName: looksCorrupted(review.reviewerName) ? fallback.reviewerName : review.reviewerName,
    content: looksCorrupted(review.content) ? fallback.content : review.content,
  };
}
