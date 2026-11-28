import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("theme", "routes/theme.ts"),
  route("logout", "routes/logout.ts"),
  route(":lang", "routes/lang.tsx", [
    index("routes/lang-home.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("property/:idSlug", "routes/listing.tsx"),
    route("listings/new", "routes/listing-new.tsx"),
    route("listings/:id/edit", "routes/listing-edit.tsx"),
    route("terms/commission", "routes/terms-commission.tsx"),
    route(":country/map", "routes/map.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
