import { z } from 'zod';
import { PROPERTIES } from '../shared/properties.js';

/**
 * The contract every review source must satisfy before anything is written
 * to the database. Collectors map their raw data into this shape; anything
 * that fails validation is rejected and counted in the run log rather than
 * silently stored.
 */
const propertyIds = PROPERTIES.map((p) => p.id) as [string, ...string[]];

const optionalText = z
  .string()
  .nullish()
  .transform((s) => {
    const t = s?.replace(/\s+\n/g, '\n').trim();
    return t ? t : null;
  });

const EARLIEST_REVIEW = Date.UTC(2010, 0, 1);

export const ReviewInputSchema = z.object({
  id: z.string().min(5),
  propertyId: z.enum(propertyIds),
  source: z.enum(['featured', 'review_list', 'import']),
  bookingReviewId: z.string().nullish().transform((v) => v ?? null),
  score: z.number().min(1).max(10),
  title: optionalText,
  positiveText: optionalText,
  negativeText: optionalText,
  language: z.string().nullish().transform((v) => v?.toLowerCase() ?? null),
  reviewedAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'reviewedAt is not a valid date')
    .refine((s) => Date.parse(s) >= EARLIEST_REVIEW, 'reviewedAt is implausibly old')
    .refine((s) => Date.parse(s) <= Date.now() + 36 * 3600_000, 'reviewedAt is in the future'),
  stayMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  nights: z.number().int().min(1).max(365).nullish().transform((v) => v ?? null),
  roomType: optionalText,
  travellerType: optionalText,
  tripPurpose: optionalText,
  guestName: optionalText,
  guestCountry: optionalText,
  hotelReply: optionalText,
});

export type ReviewInput = z.output<typeof ReviewInputSchema>;

export type ValidationResult = { ok: true; value: ReviewInput } | { ok: false; error: string };

export function validateReviewInput(raw: unknown): ValidationResult {
  const parsed = ReviewInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues.map((i) => `${i.path.join('.') || 'review'}: ${i.message}`).join('; '),
  };
}
