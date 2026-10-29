// Generated from patterkit/site-chrome; do not edit here, edit the source and run sync
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import { extensions, sectionOf } from "./extensions.mjs";

const links = (entry) => (entry.type === "link" ? [entry] : entry.entries.flatMap(links));

export const onRequest = defineRouteMiddleware((context) => {
  if (extensions.length === 0) return;
  const route = context.locals.starlightRoute;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const section = sectionOf(context.url.pathname, base);

  const ownerOf = (entry) => extensions.find((e) => links(entry).every((l) => l.href.startsWith(`${base}${e.slug}/`)));
  route.sidebar = section
    ? route.sidebar.filter((entry) => ownerOf(entry) === section).flatMap((entry) => (entry.type === "group" ? entry.entries : [entry]))
    : route.sidebar.filter((entry) => !ownerOf(entry));
  const kept = new Set(route.sidebar.flatMap(links).map((l) => l.href));
  if (route.pagination.prev && !kept.has(route.pagination.prev.href)) route.pagination.prev = undefined;
  if (route.pagination.next && !kept.has(route.pagination.next.href)) route.pagination.next = undefined;
});
