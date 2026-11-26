import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("theme", "routes/theme.ts"),
  route("logout", "routes/logout.ts"),
  route(":lang", "routes/lang.tsx", [
    index("routes/lang-home.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route(":country/map", "routes/map.tsx"),
  ]),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
