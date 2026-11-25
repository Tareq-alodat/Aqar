import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("theme", "routes/theme.ts"),
  route(":lang", "routes/lang.tsx", [
    index("routes/lang-home.tsx"),
    route(":country/map", "routes/map.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
