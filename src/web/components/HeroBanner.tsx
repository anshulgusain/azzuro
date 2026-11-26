import { useState } from 'react';
import type { HotelPhoto, MetaResponse, SummaryResponse } from '../../shared/types';
import { fmtScore } from '../lib/format';

/**
 * Photo banner at the top of every page: the chosen hotel's own Booking.com
 * photo, or one photo per hotel when "All hotels" is selected. Falls back to
 * an azure gradient if the photos can't load (e.g. offline).
 */
export function HeroBanner({ meta, summary, property }: { meta: MetaResponse | null; summary: SummaryResponse | null; property: string }) {
  const hotels = meta?.properties ?? [];
  const selected = hotels.find((h) => h.id === property) ?? null;
  // One hotel: three of its photos side by side. All hotels: each hotel's main photo.
  // (A single photo stretched across the full width would show mostly sky or ceiling.)
  const photos = selected ? selected.photos.slice(0, 3) : hotels.map((h) => h.photo).filter((p): p is HotelPhoto => p !== null);
  const scope = summary?.properties.filter((p) => !selected || p.id === selected.id) ?? [];
  const onBooking = scope.reduce((a, p) => a + (p.bookingReviewCount ?? 0), 0);
  const single = selected ? scope[0] : null;

  return (
    <section className="hero-banner" aria-label={selected ? selected.name : 'All Azzurro hotels'}>
      <div className={`hero-photos hero-photos-${Math.min(photos.length, 4)}`} aria-hidden="true">
        {photos.slice(0, 4).map((p) => (
          <BannerImage key={p.url} photo={p} />
        ))}
      </div>
      <div className="hero-shade" aria-hidden="true" />
      <div className="wrap hero-content">
        <p className="hero-eyebrow">Guest reviews · Booking.com</p>
        <h1 className="hero-title">{selected ? selected.name : 'All Azzurro hotels'}</h1>
        <p className="hero-sub">
          {single
            ? `${fmtScore(single.bookingScore)} out of 10 on Booking.com, from ${single.bookingReviewCount?.toLocaleString() ?? '?'} reviews`
            : `${hotels.length} hotels in Sydney${onBooking ? ` · ${onBooking.toLocaleString()} reviews on Booking.com` : ''}`}
        </p>
      </div>
      {photos.length > 0 && <p className="hero-credit">Photos: the hotels’ Booking.com pages</p>}
    </section>
  );
}

function BannerImage({ photo }: { photo: HotelPhoto }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="hero-photo-fallback" />;
  return <img src={photo.url} alt="" loading="eager" decoding="async" onError={() => setFailed(true)} />;
}
