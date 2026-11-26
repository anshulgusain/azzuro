/**
 * Operational topic taxonomy.
 *
 * Each topic is a list of plain-English terms. A term matches on word
 * boundaries, case-insensitively; a trailing `*` matches any word ending
 * (`dirt*` → dirt, dirty, dirtiness) and spaces match spaces or hyphens
 * (`check in` → "check in", "check-in"). `exclude` lists phrases that are
 * blanked out before this topic is matched, to stop common false positives
 * (e.g. "light rail" is a location, not room lighting).
 *
 * Kept deliberately readable: operations staff can see exactly why a review
 * was tagged, and a manager can suggest new terms without touching code
 * logic. Bump CLASSIFIER_VERSION after editing and run `npm run reclassify`.
 */
export const CLASSIFIER_VERSION = 'keywords-v1';

export type TopicId =
  | 'cleanliness'
  | 'check_in'
  | 'staff'
  | 'noise'
  | 'facilities'
  | 'location'
  | 'room_condition'
  | 'value';

export interface TopicDef {
  id: TopicId;
  label: string;
  /** One line shown to staff explaining what the topic covers. */
  description: string;
  terms: string[];
  exclude?: string[];
}

export const TOPICS: readonly TopicDef[] = [
  {
    id: 'cleanliness',
    label: 'Cleanliness',
    description: 'Dirt, dust, stains, smells, pests, housekeeping.',
    terms: [
      'clean*', 'unclean', 'dirt*', 'dust*', 'filth*', 'stain*', 'grime', 'grimy', 'grubby', 'mould*', 'mold*',
      'mildew', 'smell*', 'stink*', 'stank', 'odour*', 'odor*', 'musty', 'hygien*', 'unhygienic', 'sanit*',
      'hairs', 'hair in', 'hair on', 'cockroach*', 'roach*', 'bed bug*', 'bedbug*', 'bugs', 'insect*', 'ants',
      'pest*', 'housekeeping', 'spotless', 'tidy', 'untidy', 'messy', 'sticky', 'gross', 'disgusting', 'vomit',
      'rubbish', 'trash', 'bins', 'not emptied',
    ],
    exclude: ['cleaning fee*', 'clean fee*'],
  },
  {
    id: 'check_in',
    label: 'Check-in & check-out',
    description: 'Arrival, keys and access codes, waiting, late or early check-in, check-out.',
    terms: [
      'check in', 'checkin', 'checked in', 'checking in', 'check out', 'checkout', 'checked out', 'checking out',
      'arrival', 'arrived', 'arriving', 'late arrival', 'early check*', 'key', 'keys', 'key card', 'keycard',
      'room card', 'access card', 'lockbox', 'lock box', 'key box', 'door code', 'pin code', 'access code',
      'code', 'keypad', 'key pad', 'self check*', 'instructions', 'after hours', 'waited', 'waiting', 'queue', 'locked out',
      'let us in', 'let me in', 'registration', 'reception was closed', 'reception closed',
    ],
  },
  {
    id: 'staff',
    label: 'Staff & reception',
    description: 'Behaviour, friendliness and helpfulness of staff, reception and management.',
    terms: [
      'staff', 'reception', 'receptionist*', 'front desk', 'frontdesk', 'manager*', 'management', 'owner*',
      'employee*', 'host', 'hosts', 'concierge', 'personnel', 'customer service', 'service', 'helpful',
      'unhelpful', 'friendly', 'unfriendly', 'rude*', 'polite*', 'impolite', 'courteous', 'discourteous',
      'welcom*', 'unwelcom*', 'attitude', 'accommodating', 'hospitab*', 'hospitality', 'professional*',
      'unprofessional', 'attentive', 'responsive', 'the guy', 'the lady', 'the man', 'the woman',
    ],
    exclude: ['room service', 'cleaning service', 'service fee*', 'self check*', 'welcome pack'],
  },
  {
    id: 'noise',
    label: 'Noise',
    description: 'Noise from traffic, neighbours, events, thin walls; sleep disturbance; quietness.',
    terms: [
      'noise*', 'noisy', 'loud*', 'quiet*', 'silent', 'silence', 'thin walls', 'paper thin', 'soundproof*',
      'sound proof*', 'sound insulation', 'traffic', 'construction', 'building work*', 'music', 'party',
      'parties', 'partying', 'shouting', 'yelling', 'screaming', 'banging', 'slamming', 'door slam*',
      'earplug*', 'ear plug*', 'hear everything', 'heard everything', 'could hear', 'can hear', 'neighbour*',
      'neighbor*', "couldn't sleep", 'could not sleep', 'kept us awake', 'kept me awake', 'woke', 'woken',
      'sirens', 'drunk*', 'rowdy', 'snor*',
    ],
  },
  {
    id: 'facilities',
    label: 'Facilities & amenities',
    description: 'Wi-Fi, air conditioning, heating, hot water, kitchen, laundry, lift, parking, shared bathrooms.',
    terms: [
      'facilit*', 'amenit*', 'wifi', 'wi fi', 'internet', 'parking', 'car park', 'carpark', 'lift', 'lifts',
      'elevator*', 'stairs', 'kitchen*', 'microwave', 'fridge', 'refrigerator', 'kettle', 'coffee machine',
      'tea and coffee', 'coffee making', 'toaster', 'laundry', 'washing machine', 'dryer', 'iron', 'hair dryer',
      'hairdryer', 'pool', 'gym', 'breakfast', 'air con*', 'aircon*', 'a/c', 'ac', 'air conditioning',
      'heater', 'heating', 'ceiling fan', 'the fan', 'tv', 'television', 'netflix', 'power point*',
      'power outlet*', 'socket*', 'usb', 'luggage storage', 'store luggage', 'store our luggage',
      'common area*', 'communal', 'lounge', 'games room', 'rooftop', 'balcony', 'bbq', 'vending', 'shared bathroom*', 'shared toilet*',
      'shared shower*', 'hot water', 'water pressure',
    ],
    exclude: ['lift a finger'],
  },
  {
    id: 'location',
    label: 'Location',
    description: 'Position, transport links, nearby shops and venues, the surrounding area.',
    terms: [
      'location', 'located', 'well positioned', 'central', 'centrally', 'city centre', 'city center', 'cbd',
      'close to', 'near', 'nearby', 'walking distance', 'walk to', 'short walk', 'minute walk', 'minutes walk',
      'min walk', 'walkable', 'station', 'train', 'trains', 'light rail', 'tram', 'bus', 'buses', 'bus stop',
      'transport', 'metro', 'airport', 'shops', 'shopping', 'restaurants', 'cafes', 'bars', 'pubs',
      'nightlife', 'neighbourhood', 'neighborhood', 'area', 'suburb', 'beach', 'park', 'harbour', 'harbor',
      'opera house', 'kings cross', 'oxford st*', 'surry hills', 'paddington', 'potts point', 'chinatown',
      'stadium', 'scg', 'allianz', 'moore park', 'centennial park', 'convenient*', 'easy to find',
      'hard to find', 'dodgy area', 'sketchy area', 'unsafe area', 'rough area', 'felt unsafe', 'felt safe',
    ],
    exclude: ['common area*', 'communal area*', 'shower area', 'kitchen area', 'seating area', 'car park', 'parking'],
  },
  {
    id: 'room_condition',
    label: 'Room condition & comfort',
    description: 'Beds, room size, bathroom fixtures, furniture, maintenance, wear and tear.',
    terms: [
      'bed', 'beds', 'mattress*', 'pillow*', 'sheet*', 'linen*', 'bedding', 'duvet', 'blanket*', 'towel*',
      'furniture', 'chair*', 'desk', 'wardrobe', 'closet', 'drawers', 'carpet*', 'floor', 'floors', 'wall',
      'walls', 'ceiling', 'paint*', 'window*', 'curtain*', 'blind', 'blinds', 'blackout', 'lighting',
      'light bulb*', 'lights', 'lamp*', 'bathroom*', 'toilet*', 'shower*', 'ensuite', 'en suite', 'sink',
      'basin', 'tap', 'taps', 'drain*', 'bath', 'bathtub', 'small room', 'tiny', 'cramped', 'spacious',
      'room size', 'size of the room', 'old', 'dated', 'outdated', 'tired', 'worn*', 'shabby', 'run down',
      'rundown', 'broken', 'damaged', 'damage', 'crack*', 'peeling', 'ripped', 'torn', 'leak*', 'damp*',
      'maintenance', 'maintained', 'repair*', 'renovat*', 'refurbish*', 'modern', 'comfortable', 'comfy',
      'uncomfortable', 'cosy', 'cozy',
    ],
    exclude: [
      'shared bathroom*', 'shared toilet*', 'shared shower*', 'light rail', 'years old', 'year old',
      'ground floor', 'top floor', 'first floor', 'second floor', 'third floor', 'thin walls', 'paper thin walls',
      'ceiling fan', 'tired after',
    ],
  },
  {
    id: 'value',
    label: 'Value for money',
    description: 'Price, value, unexpected charges, deposits and refunds.',
    terms: [
      'value', 'price*', 'priced', 'pricey', 'pricy', 'expensive', 'overpriced', 'over priced', 'cheap*',
      'money', 'worth', 'cost*', 'budget', 'affordable', 'rate', 'rates', 'pay', 'paid', 'paying', 'charge*',
      'fee', 'fees', 'deposit*', 'refund*', 'bond', 'surcharge', 'bang for', 'bargain', 'good deal',
      'great deal', 'reasonabl*', 'rip off', 'ripoff', 'overcharg*',
    ],
    exclude: ['budget hotel'],
  },
] as const;

export const TOPIC_IDS = TOPICS.map((t) => t.id);

export function topicLabel(id: string): string {
  return TOPICS.find((t) => t.id === id)?.label ?? id;
}

/**
 * Review sentiment comes from the guest's own score (1–10), which is a more
 * reliable signal than inferring tone from text. Bands follow how operations
 * teams usually read Booking.com scores.
 */
export type Sentiment = 'positive' | 'neutral' | 'negative';

export const SENTIMENT_BANDS = {
  /** score >= positiveMin is positive */
  positiveMin: 8,
  /** score < negativeBelow is negative; everything between is neutral */
  negativeBelow: 6,
} as const;

export function sentimentForScore(score: number): Sentiment {
  if (score >= SENTIMENT_BANDS.positiveMin) return 'positive';
  if (score < SENTIMENT_BANDS.negativeBelow) return 'negative';
  return 'neutral';
}

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: 'Positive (8–10)',
  neutral: 'Mixed (6–7)',
  negative: 'Negative (1–5)',
};
