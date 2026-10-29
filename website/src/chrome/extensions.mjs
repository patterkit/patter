// Generated from patterkit/site-chrome; do not edit here, edit the source and run sync
const found = import.meta.glob("../extensions/generated.json", { eager: true, import: "default" });

export const extensions = Object.values(found)[0]?.extensions ?? [];

export function sectionOf(pathname, base) {
  const path = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
  const first = path.split("/")[0];
  return extensions.find((e) => e.slug === first);
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
