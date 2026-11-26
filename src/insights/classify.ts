import Sentiment from 'sentiment';
import { TOPICS, type TopicDef, type TopicId } from '../shared/topics.js';
import type { TextQuality, TopicMention } from '../shared/types.js';

/**
 * Keyword-based topic classifier.
 *
 * Booking.com asks guests two separate questions: what they liked and what
 * they disliked. We use that structure as the polarity signal: a topic found
 * in the "disliked" text is a complaint, a topic found in the "liked" text is
 * praise. This avoids most of the error that generic sentiment analysis
 * makes on short, mixed hotel reviews ("great location but noisy").
 *
 * Two data-quality guards run before classification:
 *  - Trivial "disliked" answers ("Nothing", "n/a", "all good") are ignored.
 *  - "Misplaced praise": guests sometimes write compliments in the disliked
 *    box ("Friendly staff"). If that text reads as purely positive, its
 *    topics are counted as praise rather than complaints.
 */

interface CompiledTopic {
  id: TopicId;
  patterns: Array<{ term: string; re: RegExp }>;
  excludes: RegExp[];
}

function termToRegex(term: string): RegExp {
  const parts = term
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      const wildcard = word.endsWith('*');
      const base = (wildcard ? word.slice(0, -1) : word).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return wildcard ? `${base}[a-z']*` : base;
    });
  // Words may be separated by spaces or hyphens ("check-in", "wi-fi").
  return new RegExp(`(?<![a-z0-9])${parts.join('[\\s-]+')}(?![a-z0-9])`, 'g');
}

function compile(def: TopicDef): CompiledTopic {
  return {
    id: def.id,
    patterns: def.terms.map((term) => ({ term, re: termToRegex(term) })),
    excludes: (def.exclude ?? []).map(termToRegex),
  };
}

const COMPILED: CompiledTopic[] = TOPICS.map(compile);

export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns the topics mentioned in a piece of text and the words that matched. */
export function findTopics(text: string): Map<TopicId, string[]> {
  const found = new Map<TopicId, string[]>();
  const norm = normalizeText(text);
  if (!norm) return found;
  for (const topic of COMPILED) {
    let haystack = norm;
    for (const ex of topic.excludes) haystack = haystack.replace(ex, (m) => ' '.repeat(m.length));
    const hits = new Set<string>();
    for (const { re } of topic.patterns) {
      re.lastIndex = 0;
      for (const m of haystack.matchAll(re)) hits.add(m[0]);
    }
    if (hits.size) found.set(topic.id, [...hits]);
  }
  return found;
}

const TRIVIAL_DISLIKED = [
  /^(nothing|none|nil|nope|no|na|n\/?a|nada|zero|non|rien|nichts|-+|\.+|x)$/,
  /^nothing( (really|at all|much|special|in particular|to (dislike|complain( about)?|report|say|mention)))+$/,
  /^no (complaints?|negatives?|issues?|problems?)( at all)?$/,
  /^(all|everything) (was )?(good|great|fine|perfect|excellent|ok|okay)$/,
  /^(can'?t|cannot|could ?n'?t) think of anything$/,
  /^nothing,? (it was|everything was|all was) (good|great|perfect|excellent|fine)$/,
  /^not applicable$/,
];

export function isTrivialDisliked(text: string): boolean {
  const t = normalizeText(text)
    .replace(/[!.,:;)(?\s]+$/g, '')
    .replace(/^[\s"'-]+/, '')
    .replace(/\s*[:;]-?[)d(p]\s*$/i, '')
    .trim();
  if (!t) return true;
  return TRIVIAL_DISLIKED.some((re) => re.test(t));
}

const sentimentAnalyzer = new Sentiment();
const NEGATORS = /\b(not|no|never|nor|but|however|although|though|except|lack\w*|without|wasn'?t|weren'?t|isn'?t|didn'?t|don'?t|doesn'?t|couldn'?t|can'?t|could|should|would|too|bit|only|poor\w*|bad\w*|worse|worst|small|old|noisy|dirty)\b|n't/;

/**
 * True when text in the "disliked" box is actually a compliment: it scores
 * positive on the AFINN lexicon, contains no negative words, and has no
 * negation or contrast ("not", "but", "too", "could be"). Conservative on
 * purpose: when unsure, we keep it as a complaint.
 */
export function isMisplacedPraise(text: string): boolean {
  const norm = normalizeText(text);
  if (!norm || NEGATORS.test(norm)) return false;
  const result = sentimentAnalyzer.analyze(norm);
  return result.score > 0 && result.negative.length === 0;
}

const ENGLISH_LANGS = /^en(-[a-z]{2})?$/i;
const ENGLISH_STOPWORDS = new Set(
  'the a an and or but was were is are it this that to of in on for with very not no room staff good great nice location clean we i our my'.split(
    ' ',
  ),
);

/** Uses Booking's language code when present, otherwise a stopword heuristic. */
export function looksEnglish(text: string, language: string | null): boolean {
  if (language && !ENGLISH_LANGS.test(language)) return false;
  if (language) return true;
  const words = normalizeText(text).match(/[a-z']+/g) ?? [];
  if (words.length < 3) return /^[\x00-\x7f]*$/.test(text);
  const hits = words.filter((w) => ENGLISH_STOPWORDS.has(w)).length;
  return hits / words.length >= 0.15;
}

export interface ClassificationInput {
  positiveText: string | null;
  negativeText: string | null;
  language: string | null;
}

export interface Classification {
  textQuality: TextQuality;
  topics: TopicMention[];
}

export function classifyReview(input: ClassificationInput): Classification {
  const liked = input.positiveText?.trim() ?? '';
  const dislikedRaw = input.negativeText?.trim() ?? '';
  const disliked = dislikedRaw && !isTrivialDisliked(dislikedRaw) ? dislikedRaw : '';

  if (!liked && !disliked) return { textQuality: 'no_text', topics: [] };
  if (!looksEnglish(`${liked} ${disliked}`, input.language)) return { textQuality: 'non_english', topics: [] };

  const misplaced = disliked !== '' && isMisplacedPraise(disliked);
  const mentions = new Map<string, TopicMention>();
  const add = (topic: TopicId, polarity: TopicMention['polarity'], terms: string[]) => {
    const key = `${topic}:${polarity}`;
    const existing = mentions.get(key);
    if (existing) existing.terms = [...new Set([...existing.terms, ...terms])];
    else mentions.set(key, { topic, polarity, terms });
  };

  for (const [topic, terms] of findTopics(liked)) add(topic, 'praise', terms);
  for (const [topic, terms] of findTopics(disliked)) add(topic, misplaced ? 'praise' : 'complaint', terms);

  return {
    textQuality: misplaced ? 'misplaced_praise' : 'ok',
    topics: [...mentions.values()],
  };
}
