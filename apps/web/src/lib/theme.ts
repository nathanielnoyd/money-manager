/**
 * Minimal theme handling (light / dark / system) without a dependency.
 * The inline script in the root layout applies the class before first paint.
 */
export type ThemePref = "light" | "dark" | "system";
const KEY = "mm-theme";

export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export function toggleTheme(): void {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem(KEY, dark ? "dark" : "light");
  } catch {
    // storage unavailable (private mode); the toggle still applies for this page view
  }
}
