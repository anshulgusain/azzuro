import { describe, expect, it } from 'vitest';
import { classifyReview, findTopics, isMisplacedPraise, isTrivialDisliked } from '../src/insights/classify.js';

const topicsOf = (text: string) => [...findTopics(text).keys()].sort();

describe('findTopics', () => {
  it('matches hyphenated and spaced variants', () => {
    expect(topicsOf('The check-in was quick')).toEqual(['check_in']);
    expect(topicsOf('wi-fi kept dropping')).toEqual(['facilities']);
  });

  it('uses wildcards for word endings', () => {
    expect(findTopics('Everything was dirty and dusty').get('cleanliness')).toEqual(['dirty', 'dusty']);
  });

  it('does not treat the light rail as room lighting', () => {
    expect(topicsOf('Light rail stop is nearby')).toEqual(['location']);
  });

  it('files shared bathrooms under facilities, not the room', () => {
    expect(topicsOf('Shared bathrooms were filthy')).toEqual(['cleanliness', 'facilities']);
  });

  it('collapses overlapping matches', () => {
    expect(findTopics('The door code did not work').get('check_in')).toEqual(['door code']);
  });

  it('handles curly apostrophes', () => {
    expect(topicsOf('We couldn’t sleep at all')).toEqual(['noise']);
  });
});

describe('isTrivialDisliked', () => {
  it.each(['Nothing.', 'nothing!', 'N/A', '-', 'All good', 'Nothing really', 'No complaints', 'Nothing, all was pretty good', 'nothing :)'])(
    'treats "%s" as no complaint',
    (t) => expect(isTrivialDisliked(t)).toBe(true),
  );
  it.each(['Nothing really just some trouble with the keypad', 'Noisy at night', 'No lift'])('keeps "%s"', (t) =>
    expect(isTrivialDisliked(t)).toBe(false),
  );
});

describe('isMisplacedPraise', () => {
  it('spots short compliments in the disliked box', () => {
    expect(isMisplacedPraise('Friendly staff')).toBe(true);
    expect(isMisplacedPraise('Great location, lovely stay')).toBe(true);
  });
  it('keeps real complaints, contrasts and suggestions', () => {
    expect(isMisplacedPraise('The music was pretty loud after the game')).toBe(false);
    expect(isMisplacedPraise('A proper reception desk might be better')).toBe(false);
    expect(isMisplacedPraise('Staff were nice but the room was not clean')).toBe(false);
    expect(isMisplacedPraise('Pretty good overall, a nice room and helpful people, though breakfast was average')).toBe(false);
  });
});

describe('classifyReview', () => {
  it('takes polarity from the liked/disliked fields', () => {
    const c = classifyReview({ positiveText: 'Great location, helpful staff', negativeText: 'Room was dirty and noisy', language: 'en' });
    expect(c.textQuality).toBe('ok');
    const byKey = Object.fromEntries(c.topics.map((t) => [`${t.topic}:${t.polarity}`, t.terms]));
    expect(byKey['location:praise']).toEqual(['location']);
    expect(byKey['staff:praise']?.sort()).toEqual(['helpful', 'staff']);
    expect(byKey['cleanliness:complaint']).toEqual(['dirty']);
    expect(byKey['noise:complaint']).toEqual(['noisy']);
  });

  it('ignores trivial disliked text', () => {
    const c = classifyReview({ positiveText: 'Clean room', negativeText: 'Nothing.', language: 'en' });
    expect(c.topics.every((t) => t.polarity === 'praise')).toBe(true);
  });

  it('counts misplaced praise as praise and flags it', () => {
    const c = classifyReview({ positiveText: null, negativeText: 'Friendly staff', language: 'en' });
    expect(c.textQuality).toBe('misplaced_praise');
    expect(c.topics).toEqual([{ topic: 'staff', polarity: 'praise', terms: ['staff', 'friendly'] }]);
  });

  it('flags reviews without text and non-English reviews', () => {
    expect(classifyReview({ positiveText: null, negativeText: '  ', language: 'en' }).textQuality).toBe('no_text');
    expect(classifyReview({ positiveText: 'Sehr sauber und ruhig', negativeText: null, language: 'de' }).textQuality).toBe('non_english');
    expect(classifyReview({ positiveText: 'Muy limpio, el personal muy amable y la ubicación excelente', negativeText: null, language: null }).textQuality).toBe(
      'non_english',
    );
  });
});
