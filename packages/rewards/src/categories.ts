/**
 * Reward categories: a fixed taxonomy that card earn rules are written against. It is
 * separate from a household's budget categories, which are mapped onto it (see
 * DEFAULT_CATEGORY_MAP) and can be overridden per merchant or per transaction.
 */
export const REWARD_CATEGORIES = {
  dining: { label: "Dining", description: "Restaurants, bars, cafés, takeout and food delivery." },
  groceries: {
    label: "Groceries",
    description: "US supermarkets and grocery stores (not superstores or warehouse clubs).",
  },
  online_groceries: {
    label: "Online groceries",
    description: "Grocery delivery and pickup ordered online.",
  },
  wholesale_clubs: { label: "Wholesale clubs", description: "Costco, Sam's Club, BJ's." },
  superstores: { label: "Superstores", description: "Walmart, Target and similar." },
  gas: { label: "Gas", description: "Gas stations." },
  ev_charging: { label: "EV charging", description: "Electric vehicle charging." },
  transit: {
    label: "Transit",
    description: "Trains, buses, subways, ferries, tolls, parking and bike or scooter share.",
  },
  rideshare: { label: "Rideshare", description: "Uber, Lyft and taxis." },
  airfare: { label: "Airfare", description: "Flights booked with an airline." },
  hotels: { label: "Hotels", description: "Hotels and resorts booked directly." },
  car_rental: { label: "Car rental", description: "Car rental agencies." },
  travel: {
    label: "Other travel",
    description: "Travel agencies, cruises, vacation rentals, campgrounds and other travel.",
  },
  portal_travel: {
    label: "Card travel portal",
    description: "Bookings made through the card issuer's own travel site.",
  },
  streaming: { label: "Streaming", description: "Video and music streaming subscriptions." },
  entertainment: {
    label: "Entertainment",
    description: "Movies, concerts, live events, theme parks and attractions.",
  },
  drugstores: { label: "Drugstores", description: "Pharmacies and drugstores." },
  home_improvement: { label: "Home improvement", description: "Hardware and home stores." },
  online_shopping: { label: "Online shopping", description: "Online retail purchases." },
  rent: { label: "Rent", description: "Rent payments." },
  utilities: { label: "Utilities", description: "Electric, gas, water and trash." },
  phone_internet: {
    label: "Phone & internet",
    description: "Mobile, cable and internet service providers.",
  },
  office_supply: { label: "Office supply", description: "Office supply stores." },
  shipping: { label: "Shipping", description: "Shipping and postage." },
  advertising: { label: "Advertising", description: "Online and social media advertising." },
  fitness: { label: "Fitness", description: "Gyms and fitness clubs." },
  everything_else: { label: "Everything else", description: "Anything not in another category." },
} as const;

export type RewardCategory = keyof typeof REWARD_CATEGORIES;
export const REWARD_CATEGORY_IDS = Object.keys(REWARD_CATEGORIES) as [
  RewardCategory,
  ...RewardCategory[],
];

/**
 * Starting map from the default budget categories (packages/core/src/categories.ts) to
 * reward categories. Households can change it; unmapped categories count as
 * `everything_else`. Transfers and income never earn.
 */
export const DEFAULT_CATEGORY_MAP: Record<string, RewardCategory> = {
  Restaurants: "dining",
  Coffee: "dining",
  Groceries: "groceries",
  Gas: "gas",
  "Auto & Parking": "transit",
  "Rideshare & Transit": "transit",
  Travel: "travel",
  Entertainment: "entertainment",
  Subscriptions: "streaming",
  Fitness: "fitness",
  Utilities: "utilities",
  "Internet & Phone": "phone_internet",
  "Home Improvement": "home_improvement",
  "Mortgage & Rent": "rent",
};

/**
 * Plaid's personal_finance_category (detailed), used when a transaction has no budget
 * category or one that isn't mapped. Only the clear-cut ones.
 */
export const PROVIDER_CATEGORY_MAP: Record<string, RewardCategory> = {
  FOOD_AND_DRINK_RESTAURANT: "dining",
  FOOD_AND_DRINK_FAST_FOOD: "dining",
  FOOD_AND_DRINK_COFFEE: "dining",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "everything_else",
  FOOD_AND_DRINK_GROCERIES: "groceries",
  GENERAL_MERCHANDISE_SUPERSTORES: "superstores",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "online_shopping",
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: "office_supply",
  GENERAL_MERCHANDISE_PHARMACIES_AND_SUPPLEMENTS: "drugstores",
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "drugstores",
  TRANSPORTATION_GAS: "gas",
  TRANSPORTATION_PUBLIC_TRANSIT: "transit",
  TRANSPORTATION_PARKING: "transit",
  TRANSPORTATION_TOLLS: "transit",
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "rideshare",
  TRANSPORTATION_BIKES_AND_SCOOTERS: "transit",
  TRAVEL_FLIGHTS: "airfare",
  TRAVEL_LODGING: "hotels",
  TRAVEL_RENTAL_CARS: "car_rental",
  TRAVEL_OTHER_TRAVEL: "travel",
  ENTERTAINMENT_TV_AND_MOVIES: "streaming",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "streaming",
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "entertainment",
  ENTERTAINMENT_CASINOS_AND_GAMBLING: "everything_else",
  HOME_IMPROVEMENT_HARDWARE: "home_improvement",
  RENT_AND_UTILITIES_RENT: "rent",
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "utilities",
  RENT_AND_UTILITIES_WATER: "utilities",
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "utilities",
  RENT_AND_UTILITIES_TELEPHONE: "phone_internet",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "phone_internet",
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "fitness",
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: "shipping",
};

/**
 * Statement descriptors of issuer travel portals. A purchase matching one counts as
 * `portal_travel` on that issuer's cards (and as plain travel elsewhere). Best effort:
 * descriptors vary, so people can also mark a transaction as a portal booking.
 */
export const PORTAL_DESCRIPTORS: { issuer: string; patterns: string[] }[] = [
  { issuer: "chase", patterns: ["CHASE TRAVEL", "CHASETRAVEL"] },
  {
    issuer: "american express",
    patterns: ["AMEX TRAVEL", "AMEXTRAVEL", "AMERICAN EXPRESS TRAVEL"],
  },
  {
    issuer: "capital one",
    patterns: ["CAPITAL ONE TRAVEL", "CAPITALONE TRAVEL", "CAPITAL ONE TRAV"],
  },
  { issuer: "citi", patterns: ["CITI TRAVEL", "CITITRAVEL"] },
];
