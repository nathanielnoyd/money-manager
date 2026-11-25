export interface DefaultCategoryGroup {
  name: string;
  kind: "income" | "expense" | "transfer";
  categories: { name: string; icon: string }[];
}

/** Seeded into every new household. Users can rename, hide, or delete them. */
export const DEFAULT_CATEGORY_GROUPS: DefaultCategoryGroup[] = [
  {
    name: "Income",
    kind: "income",
    categories: [
      { name: "Paycheck", icon: "briefcase" },
      { name: "Interest", icon: "percent" },
      { name: "Dividends", icon: "trending-up" },
      { name: "Other Income", icon: "plus-circle" },
    ],
  },
  {
    name: "Housing",
    kind: "expense",
    categories: [
      { name: "Mortgage & Rent", icon: "home" },
      { name: "Home Improvement", icon: "hammer" },
      { name: "Utilities", icon: "zap" },
      { name: "Internet & Phone", icon: "wifi" },
    ],
  },
  {
    name: "Food & Dining",
    kind: "expense",
    categories: [
      { name: "Groceries", icon: "shopping-basket" },
      { name: "Restaurants", icon: "utensils" },
      { name: "Coffee", icon: "coffee" },
    ],
  },
  {
    name: "Transportation",
    kind: "expense",
    categories: [
      { name: "Gas", icon: "fuel" },
      { name: "Auto & Parking", icon: "car" },
      { name: "Rideshare & Transit", icon: "train-front" },
    ],
  },
  {
    name: "Lifestyle",
    kind: "expense",
    categories: [
      { name: "Shopping", icon: "shopping-bag" },
      { name: "Entertainment", icon: "film" },
      { name: "Subscriptions", icon: "repeat" },
      { name: "Travel", icon: "plane" },
      { name: "Fitness", icon: "dumbbell" },
    ],
  },
  {
    name: "Health & Insurance",
    kind: "expense",
    categories: [
      { name: "Medical", icon: "stethoscope" },
      { name: "Insurance", icon: "shield" },
    ],
  },
  {
    name: "Financial",
    kind: "expense",
    categories: [
      { name: "Fees", icon: "receipt" },
      { name: "Taxes", icon: "landmark" },
      { name: "Gifts & Donations", icon: "gift" },
    ],
  },
  {
    name: "Transfers",
    kind: "transfer",
    categories: [
      { name: "Transfer", icon: "arrow-left-right" },
      { name: "Credit Card Payment", icon: "credit-card" },
    ],
  },
];
