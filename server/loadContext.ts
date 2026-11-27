import type { Request, Response } from "express";
import type { Knex } from "knex";
import type { AppLoadContext } from "react-router";
import { requestMeta } from "./middleware/authenticate";
import type { AuthCookies } from "./services/authCookies";
import type { AuthService, RequestMeta, Session } from "./services/authService";
import type { ViewConfig } from "./services/viewService";

/** Server services that page loaders/actions use (created once in server/createServer.ts). */
export interface AppServices {
  auth: AuthService;
  cookies: AuthCookies;
  /** Database for page loaders (map search SSR); public loaders use the same services as /api/v1. */
  db: Knex;
  /** View counting: visitor cookie settings (listing detail). */
  views: ViewConfig;
  /** Origin of PUBLIC_BASE_URL (e.g. https://aqar.example), for absolute URLs such as canonical links. */
  publicOrigin: string;
}

declare module "react-router" {
  interface AppLoadContext {
    /** Signed-in session for this request (server only; pages get `ClientUser` from the root loader). */
    session: Session | null;
    services: AppServices;
    meta: RequestMeta;
  }
}

/**
 * `getLoadContext` for the React Router handler (server/createServer.ts). It
 * closes over this process's services, so loaders can never run without them.
 * `res.locals.session` is set by the `authenticate` middleware just before.
 */
export function createGetLoadContext(services: AppServices) {
  return (req: Request, res: Response): AppLoadContext => ({
    session: res.locals.session ?? null,
    services,
    meta: requestMeta(req),
  });
}
