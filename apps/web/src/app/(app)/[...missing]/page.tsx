import { notFound } from "next/navigation";

/**
 * Any address under the app that no page matches. Rendering the not-found page from inside the
 * (app) group keeps the signed-in shell and navigation around it.
 */
export default function Missing() {
  notFound();
}
