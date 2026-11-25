/** Dollars (as operations return them) → cents (as <Money> takes them). */
export const cents = (dollars: number) => Math.round(dollars * 100);
